import { localizeRoot, onLanguageChange } from './localization.mjs';

const TOOLBAR_HEIGHT = 52;
const TAB_HEIGHT = 38;
const STORAGE_KEY = 'playcanvas.work-panel.v2';
const DEFAULT_WHITELIST = 'https://example.com,https://example.org,https://example.net';
const NO_SIGNAL_SVG = `<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="s" y2="1"><stop stop-color="#06131f"/><stop offset="1" stop-color="#123b43"/></linearGradient><filter id="g"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="1280" height="720" fill="url(#s)"/><g fill="#8fe9ef" opacity=".7"><circle cx="90" cy="80" r="2"/><circle cx="260" cy="130" r="2"/><circle cx="590" cy="70" r="2"/><circle cx="900" cy="110" r="2"/><circle cx="1180" cy="70" r="2"/></g><path d="M0 590l150-95 150 82 140-105 170 110 150-80 160 88 150-100 210 95v135H0z" fill="#0a222d"/><g transform="translate(300 160) rotate(12)" stroke="#9bc9cf" stroke-width="5"><path d="M-145-42h115v84h-115zm200 0h115v84H55z" fill="#17445b"/><rect x="-28" y="-52" width="86" height="104" rx="14" fill="#879ba0"/><path d="M15 52v35M-10 86q25 28 50 0" fill="none"/><circle cx="15" cy="84" r="7" fill="#72f4ee"/></g><g fill="none" stroke="#68e8e5" stroke-width="9" stroke-linecap="round" filter="url(#g)"><path d="M354 276q42 13 66 50"/><path d="M375 235q72 24 108 90"/></g><g transform="translate(610 370)" stroke="#ff7569" stroke-width="22" stroke-linecap="round" filter="url(#g)"><path d="M-38-38l76 76m0-76l-76 76"/></g><g transform="translate(855 430)" stroke="#a8c8c9" stroke-width="6"><path d="M130 75C55 102 2 60-18 10 50-14 112-5 152 26c-3 21-10 38-22 49z" fill="#55747a"/><circle cx="128" cy="72" r="10" fill="#72f4ee"/><path d="M128 78l-30 120m30-120l65 120" stroke-width="14"/><path d="M58 198h160l38 92H20z" fill="#142c34"/><path d="M220 205v-55"/><circle cx="220" cy="143" r="7" fill="#ffb060" stroke="none"/></g></svg>`;

/** Web-only Work browser. Each tab owns a persistent iframe while the game keeps running. */
export class WorkPanel {
    constructor({ onOpen, onClose, whitelistUrls = DEFAULT_WHITELIST } = {}) {
        this.onOpen = onOpen; this.onClose = onClose;
        this.whitelist = this.parseWhitelist(whitelistUrls);
        this.tabs = []; this.activeTabId = null; this.isOpen = false; this.isMaximized = false;
        this.settings = this.loadSettings();
        this.inputMode = navigator.maxTouchPoints > 0 || globalThis.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse';
        this._onViewportChange = () => this.layout();
        this._onInputMode = (event) => { if (event.pointerType === 'touch' || event.pointerType === 'pen') this.inputMode = 'touch'; else if (event.pointerType === 'mouse') this.inputMode = 'mouse'; };
        this._onSecurityPolicyViolation = (event) => {
            if (!this.isOpen || !String(event.violatedDirective ?? '').includes('frame')) return;
            const tab = this.active();
            if (!tab?.requestedUrl || !event.blockedURI) return;
            try {
                if (new URL(event.blockedURI).origin !== new URL(tab.requestedUrl).origin) return;
            } catch { return; }
            this.showNoSignal(tab);
        };
        this._onNavigationMessage = (event) => {
            if (!this.isOpen || event.data?.type !== 'work-browser:open-tab') return;
            const sourceTab = this.tabs.find((tab) => tab.frame.contentWindow === event.source);
            if (!sourceTab || !this.isWhitelisted(event.origin)) return;
            this.openRequestedTab(sourceTab, event.data.url, event.origin);
        };
        document.addEventListener('pointerdown', this._onInputMode, true);
        document.addEventListener('securitypolicyviolation', this._onSecurityPolicyViolation);
        window.addEventListener('message', this._onNavigationMessage);
    }

    open() { this.create(); this.isOpen = true; this.root.style.display = 'block'; this.restoreButton.style.display = 'none'; if (!this.settings.aspectLocked) this.settings.aspect = this.inputMode === 'touch' ? '9:16' : '16:9'; if (!this.tabs.length) this.newTab(); this.layout(); this.onOpen?.(); }
    close() { if (!this.isOpen) return; this.isOpen = false; this.root.style.display = 'none'; this.onClose?.(); }
    minimize() { if (!this.isOpen) return; this.isOpen = false; this.root.style.display = 'none'; this.restoreButton.style.display = 'flex'; this.onClose?.(); }
    restore() { this.restoreButton.style.display = 'none'; this.open(); }

    create() {
        if (this.root) return;
        this.root = document.createElement('div'); this.root.id = 'work-overlay-root';
        Object.assign(this.root.style, { position: 'fixed', inset: '0', zIndex: '1500000', pointerEvents: 'none', display: 'none' });
        this.panel = document.createElement('section'); this.panel.setAttribute('aria-label', 'Work browser');
        Object.assign(this.panel.style, { position: 'fixed', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(255,255,255,.3)', borderRadius: '12px', background: '#161616', boxShadow: '0 18px 55px rgba(0,0,0,.62)', pointerEvents: 'auto', boxSizing: 'border-box' });
        this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
        this.tabsBar = document.createElement('div'); Object.assign(this.tabsBar.style, { height: `${TAB_HEIGHT}px`, minHeight: `${TAB_HEIGHT}px`, display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px', background: '#202020', boxSizing: 'border-box', touchAction: 'none' });
        this.tabsBar.addEventListener('pointerdown', (event) => this.startDrag(event));
        const makeButton = (label, title, action, width = '36px') => {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
            Object.assign(button.style, { width, height: '36px', minWidth: width, padding: '0', border: '1px solid rgba(255,255,255,.22)', borderRadius: '7px', background: 'rgba(255,255,255,.1)', color: '#fff', cursor: 'pointer', touchAction: 'manipulation', fontSize: '14px' }); button.addEventListener('click', action); return button;
        };
        this.toolbar = document.createElement('div'); Object.assign(this.toolbar.style, { height: `${TOOLBAR_HEIGHT}px`, minHeight: `${TOOLBAR_HEIGHT}px`, display: 'flex', alignItems: 'center', gap: '5px', padding: '7px', background: '#292929', boxSizing: 'border-box', position: 'relative' });
        this.addressInput = document.createElement('input'); this.addressInput.type = 'text'; this.addressInput.readOnly = true; this.addressInput.placeholder = 'Select an app'; this.addressInput.setAttribute('aria-label', 'Current app address');
        Object.assign(this.addressInput.style, { flex: '1 1 auto', minWidth: '50px', height: '36px', padding: '0 9px', border: '1px solid rgba(255,255,255,.26)', borderRadius: '7px', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' });
        this.toolbar.append(makeButton('←', 'Back', () => this.go(-1)), makeButton('→', 'Forward', () => this.go(1)), makeButton('↻', 'Reload', () => this.refresh()), makeButton('⌂', 'Home', () => this.goHome()), this.addressInput);
        this.secondaryActions = document.createElement('div'); Object.assign(this.secondaryActions.style, { display: 'flex', alignItems: 'center', gap: '5px' });
        this.secondaryActions.append(makeButton('−', 'Zoom out', () => this.changeZoom(-10)), this.zoomButton = makeButton('100%', 'Reset page zoom', () => this.setZoom(100), '46px'), makeButton('+', 'Zoom in', () => this.changeZoom(10)), makeButton('16:9', 'Landscape ratio', () => this.setAspect('16:9'), '42px'), makeButton('9:16', 'Portrait ratio', () => this.setAspect('9:16'), '42px'), makeButton('□', 'Maximize or restore', () => this.toggleMaximize()), makeButton('—', 'Minimize', () => this.minimize()), makeButton('×', 'Close Work', () => this.close()));
        this.moreButton = makeButton('⋯', 'More browser controls', () => this.toggleMore()); this.moreButton.style.display = 'none';
        this.moreMenu = document.createElement('div'); Object.assign(this.moreMenu.style, { position: 'absolute', right: '7px', top: '48px', zIndex: '20', display: 'none', flexWrap: 'wrap', gap: '6px', width: '190px', padding: '8px', border: '1px solid rgba(255,255,255,.25)', borderRadius: '8px', background: '#303030', boxShadow: '0 9px 24px rgba(0,0,0,.45)' });
        this.toolbar.append(this.secondaryActions, this.moreButton, this.moreMenu);
        this.content = document.createElement('div'); Object.assign(this.content.style, { position: 'relative', flex: '1 1 auto', minHeight: '0', overflow: 'hidden', background: '#fff' });
        this.status = document.createElement('div'); Object.assign(this.status.style, { position: 'absolute', left: '8px', bottom: '3px', zIndex: '4', maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,.7)', fontSize: '10px', pointerEvents: 'none' });
        this.resizeHandle = document.createElement('div'); Object.assign(this.resizeHandle.style, { position: 'absolute', right: '0', bottom: '0', zIndex: '5', width: '34px', height: '34px', cursor: 'nwse-resize', touchAction: 'none' }); this.resizeHandle.addEventListener('pointerdown', (event) => this.startResize(event));
        this.panel.append(this.tabsBar, this.toolbar, this.content, this.status, this.resizeHandle); this.root.appendChild(this.panel); document.body.appendChild(this.root);
        this.restoreButton = makeButton('◎', 'Restore Work browser', () => this.restore(), '52px'); this.restoreButton.dataset.workControl = 'true'; this.restoreButton.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21"/></svg>'; Object.assign(this.restoreButton.style, { position: 'fixed', right: 'calc(env(safe-area-inset-right, 0px) + 14px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)', display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: '1500001', pointerEvents: 'auto' }); document.body.appendChild(this.restoreButton);
        if (typeof ResizeObserver !== 'undefined') {
            this._toolbarObserver = new ResizeObserver(() => this.updateToolbarDensity());
            this._toolbarObserver.observe(this.panel);
        }
        this._disposeLocalization = localizeRoot(this.root);
        this._disposeRestoreLocalization = localizeRoot(this.restoreButton);
        this._unsubscribeLanguage = onLanguageChange(() => {
            // Compact-menu buttons are clones: rebuild them from the newly
            // translated toolbar instead of retaining an old language.
            this.moreMenu.replaceChildren();
            this.moreMenu.style.display = 'none';
        });
        window.addEventListener('resize', this._onViewportChange); window.addEventListener('orientationchange', this._onViewportChange); window.visualViewport?.addEventListener('resize', this._onViewportChange);
    }

    loadSettings() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; } }
    saveSettings() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* Storage can be unavailable in private or embedded contexts. */ } }
    parseWhitelist(value) {
        const entries = [];
        const origins = new Set();
        for (const item of String(value ?? '').split(',')) {
            const text = item.trim();
            if (!text) continue;
            try {
                const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
                if (!/^https?:$/.test(url.protocol) || origins.has(url.origin)) continue;
                origins.add(url.origin);
                entries.push({ url: url.href, origin: url.origin, host: url.hostname.replace(/^www\./, '') });
            } catch { /* Invalid entries are ignored without breaking the launcher. */ }
        }
        return entries;
    }
    isWhitelisted(url) { try { return this.whitelist.some((entry) => entry.origin === new URL(url).origin); } catch { return false; } }
    active() { return this.tabs.find((tab) => tab.id === this.activeTabId); }
    defaultAspect() { return this.inputMode === 'touch' ? '9:16' : '16:9'; }
    viewport() { const v = window.visualViewport; return { left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0, width: v?.width ?? innerWidth, height: v?.height ?? innerHeight }; }
    ratio() { return (this.settings.aspect ?? this.defaultAspect()) === '9:16' ? 9 / 16 : 16 / 9; }
    layout() {
        if (!this.isOpen || !this.panel) return;
        const v = this.viewport(), chrome = TOOLBAR_HEIGHT + TAB_HEIGHT, maxWidth = v.width * (v.width < v.height ? .96 : .92), maxHeight = v.height * .88;
        let frame = this.isMaximized ? { x: v.left, y: v.top, width: v.width, height: v.height } : this.settings.frame;
        if (!frame) { const width = Math.min(maxWidth, (maxHeight - chrome) * this.ratio()); frame = { x: v.left + (v.width - width) / 2, y: v.top + (v.height - width / this.ratio() - chrome) / 2, width, height: width / this.ratio() + chrome }; }
        this.setFrame(frame, false);
    }
    setFrame(frame, persist = true) {
        const v = this.viewport(), chrome = TOOLBAR_HEIGHT + TAB_HEIGHT, maxWidth = v.width * (v.width < v.height ? .96 : .92), maxHeight = v.height * .88;
        const width = Math.max(Math.min(300, maxWidth), Math.min(frame.width, maxWidth)); const height = Math.max(Math.min(180 + chrome, maxHeight), Math.min(frame.height, maxHeight));
        const normalized = { x: Math.max(v.left - width + 60, Math.min(frame.x, v.left + v.width - 60)), y: Math.max(v.top, Math.min(frame.y, v.top + v.height - TAB_HEIGHT)), width, height };
        Object.assign(this.panel.style, { left: `${normalized.x}px`, top: `${normalized.y}px`, width: `${normalized.width}px`, height: `${normalized.height}px` }); if (persist && !this.isMaximized) { this.settings.frame = normalized; this.saveSettings(); }
    }
    setAspect(aspect) { this.settings.aspect = aspect; this.settings.aspectLocked = true; delete this.settings.frame; this.saveSettings(); this.layout(); }
    updateToolbarDensity() { if (!this.panel) return; const compact = this.panel.clientWidth < 760; this.secondaryActions.style.display = compact ? 'none' : 'flex'; this.moreButton.style.display = compact ? 'block' : 'none'; if (!compact) this.moreMenu.style.display = 'none'; }
    toggleMore() { const open = this.moreMenu.style.display !== 'flex'; const sourceButtons = [...this.secondaryActions.querySelectorAll('button')]; this.moreMenu.replaceChildren(...sourceButtons.map((button) => button.cloneNode(true))); for (const [index, button] of [...this.moreMenu.querySelectorAll('button')].entries()) button.addEventListener('click', () => { sourceButtons[index].click(); this.moreMenu.style.display = 'none'; }); this.moreMenu.style.display = open ? 'flex' : 'none'; }
    toggleMaximize() { this.isMaximized = !this.isMaximized; this.layout(); }
    endPointerInteraction() { this._activePointerCleanup?.(); }
    startDrag(event) {
        if (event.target instanceof Element && event.target.closest('button')) return;
        event.preventDefault();
        this.endPointerInteraction();
        const start = this.settings.frame ?? { x: this.panel.offsetLeft, y: this.panel.offsetTop, width: this.panel.offsetWidth, height: this.panel.offsetHeight };
        const move = (e) => this.setFrame({ ...start, x: start.x + e.clientX - event.clientX, y: start.y + e.clientY - event.clientY });
        const end = () => this.endPointerInteraction();
        this._activePointerCleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            this._activePointerCleanup = null;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }
    startResize(event) {
        event.preventDefault();
        event.stopPropagation();
        this.endPointerInteraction();
        const start = this.settings.frame ?? { x: this.panel.offsetLeft, y: this.panel.offsetTop, width: this.panel.offsetWidth, height: this.panel.offsetHeight };
        const move = (e) => {
            const width = start.width + e.clientX - event.clientX;
            const height = width / this.ratio() + TOOLBAR_HEIGHT + TAB_HEIGHT;
            this.setFrame({ ...start, width, height });
        };
        const end = () => this.endPointerInteraction();
        this._activePointerCleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            this._activePointerCleanup = null;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }
    newTab(initialUrl = '') {
        if (this.tabs.length >= 3) return this.setStatus('A maximum of three tabs is allowed.');
        const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        const frame = document.createElement('iframe');
        frame.title = 'Work web page';
        frame.setAttribute('allow', 'autoplay; clipboard-read; clipboard-write; fullscreen');
        frame.setAttribute('sandbox', 'allow-forms allow-same-origin allow-scripts allow-downloads');
        Object.assign(frame.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', border: '0', background: '#fff', transformOrigin: 'top left' });
        const tab = { id, frame, history: [], index: -1, zoom: 100, title: 'Apps', loadTimer: null, errorLayer: null, launcher: null, mode: 'home', noSignal: false };
        tab.launcher = this.createLauncher(tab);
        tab.errorLayer = this.createNoSignalLayer(tab);
        frame.addEventListener('load', () => this.finishLoad(tab));
        frame.addEventListener('error', () => this.showNoSignal(tab));
        this.content.append(frame, tab.launcher, tab.errorLayer);
        this.tabs.push(tab);
        this.switchTab(id);
        this.showLauncher(tab);
        if (initialUrl) this.openApp(tab, initialUrl);
        return tab;
    }
    switchTab(id) { this.activeTabId = id; for (const tab of this.tabs) { const active = tab.id === id; tab.frame.style.display = active && tab.mode === 'page' ? 'block' : 'none'; tab.launcher.style.display = active && tab.mode === 'home' ? 'grid' : 'none'; tab.errorLayer.style.display = active && tab.mode === 'signal' ? 'flex' : 'none'; } const tab = this.active(); this.addressInput.value = tab.mode === 'page' || tab.mode === 'signal' ? (tab.requestedUrl ?? '') : ''; this.applyZoom(tab); this.renderTabs(); }
    closeTab(id) { const tab = this.tabs.find((item) => item.id === id); if (tab?.loadTimer) clearTimeout(tab.loadTimer); tab?.frame.remove(); tab?.launcher?.remove(); tab?.errorLayer?.remove(); this.tabs = this.tabs.filter((item) => item.id !== id); if (this.activeTabId === id) this.activeTabId = this.tabs[0]?.id ?? null; if (this.activeTabId) this.switchTab(this.activeTabId); else this.newTab(); }
    renderTabs() { this.tabsBar.replaceChildren(); for (const tab of this.tabs) { const button = document.createElement('button'); button.type = 'button'; button.textContent = `${tab.title} ×`; Object.assign(button.style, { maxWidth: '135px', height: '29px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '0', borderRadius: '5px', padding: '0 8px', color: '#fff', background: tab.id === this.activeTabId ? '#466f97' : 'rgba(255,255,255,.1)' }); button.addEventListener('click', (event) => event.offsetX > button.clientWidth - 22 ? this.closeTab(tab.id) : this.switchTab(tab.id)); this.tabsBar.appendChild(button); } const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.addEventListener('click', () => this.newTab()); this.tabsBar.appendChild(plus); }
    openApp(tab, url) { if (!tab || !this.isWhitelisted(url)) return; tab.history.splice(tab.index + 1); tab.history.push(url); tab.index++; this.loadTab(tab, url); }
    openRequestedTab(sourceTab, value, baseUrl = sourceTab?.requestedUrl) {
        if (!sourceTab || typeof value !== 'string' || !value.trim()) return null;
        let url;
        try { url = new URL(value, baseUrl).href; } catch { return null; }
        if (!this.isWhitelisted(url)) {
            this.setStatus('The requested page is not in the app whitelist.');
            return null;
        }
        if (this.tabs.length >= 3) {
            this.setStatus('A maximum of three tabs is allowed.');
            return null;
        }
        return this.newTab(url);
    }
    attachSameOriginNavigation(tab) {
        let frameWindow;
        let document;
        try {
            frameWindow = tab.frame.contentWindow;
            document = tab.frame.contentDocument;
            if (!frameWindow || !document || frameWindow.location.href === 'about:blank') return;
        } catch { return; }
        const openTab = (value) => this.openRequestedTab(tab, String(value ?? ''), frameWindow.location.href);
        document.addEventListener('click', (event) => {
            const link = event.target?.closest?.('a[href]');
            if (!link) return;
            const wantsNewTab = link.target.toLowerCase() === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey;
            if (!wantsNewTab) return;
            event.preventDefault();
            event.stopPropagation();
            openTab(link.href);
        }, true);
        document.addEventListener('submit', (event) => {
            const form = event.target;
            if (!(form instanceof frameWindow.HTMLFormElement) || form.target.toLowerCase() !== '_blank') return;
            event.preventDefault();
            const url = new URL(form.action || frameWindow.location.href, frameWindow.location.href);
            if ((form.method || 'get').toLowerCase() === 'get') {
                for (const [key, value] of new frameWindow.FormData(form)) url.searchParams.append(key, value);
            }
            openTab(url.href);
        }, true);
        try {
            frameWindow.open = (value) => {
                openTab(value);
                return null;
            };
        } catch { /* Some same-origin pages make window.open read-only. */ }
    }
    go(step) { const tab = this.active(); if (!tab) return; const url = tab.history[tab.index + step]; if (url) { tab.index += step; this.loadTab(tab, url); return; } if (step < 0) this.showLauncher(tab); }
    refresh() { const tab = this.active(); if (tab?.requestedUrl && tab.mode !== 'home') this.loadTab(tab, tab.requestedUrl); }
    goHome() { this.showLauncher(this.active()); }
    changeZoom(delta) { this.setZoom((this.active()?.zoom ?? 100) + delta); }
    setZoom(zoom) { const tab = this.active(); if (!tab) return; tab.zoom = Math.max(50, Math.min(200, zoom)); this.applyZoom(tab); }
    applyZoom(tab) { const scale = tab.zoom / 100; tab.frame.style.transform = `scale(${scale})`; tab.frame.style.width = `${100 / scale}%`; tab.frame.style.height = `${100 / scale}%`; this.zoomButton.textContent = `${tab.zoom}%`; }
    createLauncher(tab) {
        const launcher = document.createElement('div');
        Object.assign(launcher.style, { position: 'absolute', inset: '0', zIndex: '2', display: 'none', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', alignContent: 'start', gap: 'clamp(16px, 4vw, 30px)', padding: 'clamp(24px, 6vw, 58px)', overflow: 'auto', boxSizing: 'border-box', background: 'radial-gradient(circle at 50% 0%, #173a48 0%, #0a202b 52%, #06151e 100%)', fontFamily: 'system-ui, -apple-system, sans-serif' });
        if (!this.whitelist.length) {
            const empty = document.createElement('div'); empty.textContent = 'No apps configured'; Object.assign(empty.style, { gridColumn: '1 / -1', alignSelf: 'center', color: 'rgba(225,247,250,.55)', textAlign: 'center', fontSize: '14px', letterSpacing: '.8px' }); launcher.appendChild(empty); return launcher;
        }
        for (const entry of this.whitelist) {
            const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', `Open ${entry.host}`);
            Object.assign(button.style, { minWidth: '0', padding: '0', border: '0', background: 'transparent', color: '#eafcff', cursor: 'pointer', touchAction: 'manipulation', textAlign: 'center' });
            const icon = document.createElement('span'); Object.assign(icon.style, { position: 'relative', width: 'clamp(62px, 13vw, 82px)', height: 'clamp(62px, 13vw, 82px)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 9px', overflow: 'hidden', border: '1px solid rgba(137,229,232,.3)', borderRadius: '22%', background: 'linear-gradient(145deg, rgba(62,134,148,.72), rgba(18,52,65,.94))', boxShadow: '0 10px 24px rgba(0,0,0,.3)', fontSize: '30px', fontWeight: '700', textTransform: 'uppercase' });
            const initial = document.createElement('span'); initial.textContent = entry.host.charAt(0); icon.appendChild(initial);
            const image = document.createElement('img'); image.alt = ''; image.src = `${entry.origin}/favicon.ico`; Object.assign(image.style, { position: 'absolute', width: '54%', height: '54%', objectFit: 'contain' }); image.addEventListener('load', () => { initial.style.display = 'none'; }); image.addEventListener('error', () => image.remove()); icon.appendChild(image);
            const label = document.createElement('span'); label.textContent = entry.host; Object.assign(label.style, { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', textShadow: '0 2px 6px rgba(0,0,0,.65)' });
            button.append(icon, label); button.addEventListener('click', () => this.openApp(tab, entry.url)); launcher.appendChild(button);
        }
        return launcher;
    }
    showLauncher(tab) {
        if (!tab) return;
        if (tab.loadTimer) clearTimeout(tab.loadTimer);
        tab.loadTimer = null; tab.mode = 'home'; tab.noSignal = false; tab.title = 'Apps';
        tab.frame.style.visibility = 'hidden'; tab.frame.style.display = 'none'; tab.frame.src = 'about:blank'; tab.errorLayer.style.display = 'none';
        if (tab.id === this.activeTabId) { tab.launcher.style.display = 'grid'; this.addressInput.value = ''; this.setStatus(''); }
        this.renderTabs();
    }
    createNoSignalLayer(tab) {
        const layer = document.createElement('div');
        Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: '3', display: 'none', alignItems: 'flex-end', justifyContent: 'center', boxSizing: 'border-box', padding: 'clamp(18px, 5vw, 38px)', overflow: 'hidden', background: '#071923' });
        const art = document.createElement('div'); art.innerHTML = NO_SIGNAL_SVG; Object.assign(art.style, { position: 'absolute', inset: '0' }); Object.assign(art.firstElementChild.style, { width: '100%', height: '100%', display: 'block', objectFit: 'cover' });
        const retry = document.createElement('button'); retry.type = 'button'; retry.setAttribute('aria-label', 'Retry connection'); retry.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'; Object.assign(retry.style, { width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', border: '1px solid rgba(156,246,242,.55)', borderRadius: '50%', background: 'rgba(4,18,26,.78)', boxShadow: '0 8px 24px rgba(0,0,0,.38)', color: '#9cf6f2', touchAction: 'manipulation' }); retry.addEventListener('click', () => this.loadTab(tab, tab.history[tab.index]));
        retry.style.position = 'relative'; retry.style.zIndex = '1'; layer.append(art, retry); return layer;
    }
    loadTab(tab, url) {
        if (!tab || !url) return;
        if (tab.loadTimer) clearTimeout(tab.loadTimer);
        tab.noSignal = false;
        tab.mode = 'page';
        tab.requestedUrl = url;
        tab.awaitingRequestedLoad = true;
        try { tab.title = new URL(url).hostname.replace(/^www\./, ''); } catch { tab.title = 'App'; }
        if (tab.id === this.activeTabId) this.addressInput.value = url;
        tab.launcher.style.display = 'none';
        tab.errorLayer.style.display = 'none';
        tab.frame.style.visibility = 'visible';
        tab.frame.style.display = tab.id === this.activeTabId ? 'block' : 'none';
        this.renderTabs();
        if (!this.isWhitelisted(url)) {
            tab.awaitingRequestedLoad = false;
            this.showNoSignal(tab);
            return;
        }
        this.setStatus('Establishing connection…');
        tab.frame.src = url;
    }
    finishLoad(tab) {
        try {
            if (tab.frame.contentWindow?.location.href === 'about:blank') return;
        } catch { /* Cross-origin pages intentionally hide their URL. */ }
        if (tab.loadTimer) clearTimeout(tab.loadTimer);
        tab.loadTimer = null;
        if (tab.awaitingRequestedLoad) {
            tab.awaitingRequestedLoad = false;
            if (tab.id === this.activeTabId) this.addressInput.value = tab.requestedUrl;
        }
        this.attachSameOriginNavigation(tab);
        if (tab.errorLayer.style.display !== 'flex') this.setStatus('Page loaded.');
    }
    showNoSignal(tab) {
        if (!tab) return;
        if (tab.loadTimer) clearTimeout(tab.loadTimer);
        tab.loadTimer = null;
        tab.noSignal = true;
        tab.mode = 'signal';
        tab.title = 'Offline';
        tab.frame.style.visibility = 'hidden';
        tab.frame.style.display = 'none';
        tab.launcher.style.display = 'none';
        tab.errorLayer.style.display = tab.id === this.activeTabId ? 'flex' : 'none';
        this.renderTabs();
        this.setStatus('');
    }
    setStatus(text) { this.status.textContent = text; }
    destroy() { this._unsubscribeLanguage?.(); this._disposeLocalization?.(); this._disposeRestoreLocalization?.(); this.endPointerInteraction(); for (const tab of this.tabs) if (tab.loadTimer) clearTimeout(tab.loadTimer); document.removeEventListener('pointerdown', this._onInputMode, true); document.removeEventListener('securitypolicyviolation', this._onSecurityPolicyViolation); window.removeEventListener('message', this._onNavigationMessage); window.removeEventListener('resize', this._onViewportChange); window.removeEventListener('orientationchange', this._onViewportChange); window.visualViewport?.removeEventListener('resize', this._onViewportChange); this._toolbarObserver?.disconnect(); this.restoreButton?.remove(); this.root?.remove(); this.root = null; }
}
