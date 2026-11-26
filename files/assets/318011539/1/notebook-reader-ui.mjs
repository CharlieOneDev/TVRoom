import { getLanguage, onLanguageChange, localizeRoot, t } from './localization.mjs';
import { getInteractionContent } from './interaction-content.mjs';

export class NotebookReaderUI {
    constructor(onClose) {
        this.onClose = onClose;
        this.pageIndex = 0;
        this.config = null;
        this.closeTimer = null;
        this.previousFocus = null;
        this.build();
        this._unsubscribeLanguage = onLanguageChange(() => {
            const content = getInteractionContent(this.config?.id);
            if (content) this.config = { ...this.config, ...content };
            this.render();
        });
    }

    build() {
        if (typeof document === 'undefined') return;
        this.host = document.createElement('div');
        this.host.setAttribute('data-scene-interaction-ui', 'notebook');
        Object.assign(this.host.style, {
            position: 'fixed', inset: '0', zIndex: '1700000',
            display: 'none', pointerEvents: 'none'
        });
        const shadow = this.host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                *, *::before, *::after { box-sizing: border-box; }
                .pcnb-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
                    padding:max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right))
                    max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
                    background:rgba(8,5,3,.78); opacity:0; transition:opacity .2s ease;
                    font-family:Georgia, 'Noto Serif', 'Noto Serif CJK SC', 'Noto Serif CJK TC', 'Yu Mincho', 'Songti SC', 'PMingLiU', serif; color:#382619; }
                .pcnb-overlay.open { opacity:1; }
                .pcnb-book { position:relative; width:min(1080px, 94vw); height:min(720px, 88dvh); padding:25px;
                    border:2px solid #2b160d; border-radius:12px 18px 18px 12px;
                    background:linear-gradient(115deg,#2c160d 0%,#57321e 13%,#3a1e12 48%,#211109 100%);
                    box-shadow:0 28px 80px #000, inset 0 0 0 5px rgba(135,88,46,.22), inset 0 0 38px #160b06; }
                .pcnb-book::before { content:''; position:absolute; inset:8px; pointer-events:none; border:1px solid rgba(210,155,91,.2);
                    border-radius:8px 14px 14px 8px; background:repeating-linear-gradient(77deg,transparent 0 5px,rgba(255,255,255,.015) 6px,transparent 8px); }
                .pcnb-pages { position:relative; display:grid; grid-template-columns:1fr 1fr; height:100%; overflow:hidden;
                    border-radius:4px 9px 9px 4px; background:#d5bd85; box-shadow:inset 0 0 35px rgba(62,35,16,.7), 0 4px 16px #130a05; }
                .pcnb-pages::after { content:''; position:absolute; top:0; bottom:0; left:50%; width:34px; transform:translateX(-50%);
                    pointer-events:none; background:linear-gradient(90deg,rgba(60,34,18,.08),rgba(48,25,12,.42),rgba(255,239,184,.18),rgba(60,34,18,.1)); z-index:3; }
                .pcnb-page { position:relative; min-width:0; padding:clamp(38px,5vw,64px) clamp(28px,5vw,66px) 46px;
                    overflow-y:auto; overscroll-behavior:contain; touch-action:pan-y; scrollbar-color:#876840 transparent;
                    background:radial-gradient(circle at 14% 18%,rgba(112,68,27,.18) 0 2px,transparent 18px),
                    radial-gradient(circle at 87% 72%,rgba(86,50,21,.14),transparent 23%),
                    linear-gradient(98deg,rgba(73,43,20,.24),transparent 7%,transparent 92%,rgba(68,39,17,.24)),
                    repeating-linear-gradient(0deg,rgba(72,48,22,.025) 0 1px,transparent 1px 4px),#e6d29f; }
                .pcnb-page:nth-child(2) { background-color:#e2cc96; }
                .pcnb-noise { position:absolute; inset:0; width:100%; height:100%; opacity:.12; pointer-events:none; mix-blend-mode:multiply; z-index:2; }
                .pcnb-page-inner { position:relative; z-index:1; min-height:100%; display:flex; flex-direction:column; }
                .pcnb-kicker { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:#765437; margin-bottom:9px; }
                .pcnb-title { margin:0 0 8px; color:#3b2819; font-size:clamp(25px,3vw,38px); font-weight:700; line-height:1.08; }
                .pcnb-date { padding-bottom:14px; margin-bottom:20px; border-bottom:1px solid rgba(74,46,24,.35); color:#76563a; font-size:13px; font-style:italic; }
                .pcnb-body { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:clamp(15px,1.6vw,19px); line-height:1.78; letter-spacing:.012em; }
                .pcnb-number { margin-top:auto; padding-top:24px; text-align:center; color:#795c3e; font-size:12px; }
                .pcnb-close { position:absolute; z-index:8; top:10px; right:12px; width:40px; height:40px; border:1px solid rgba(239,216,169,.42);
                    border-radius:50%; background:rgba(30,15,8,.72); color:#f1dfb9; font:25px/1 Arial,sans-serif; cursor:pointer; }
                .pcnb-close:hover,.pcnb-close:focus-visible,.pcnb-nav button:hover,.pcnb-nav button:focus-visible { outline:2px solid #d8ae68; outline-offset:2px; }
                .pcnb-nav { position:absolute; z-index:7; left:50%; bottom:8px; transform:translateX(-50%); display:flex; align-items:center; gap:12px;
                    padding:6px 10px; border-radius:20px; background:rgba(37,20,11,.84); color:#ecd8ae; font:13px Arial,sans-serif; box-shadow:0 3px 12px #0008; }
                .pcnb-nav button { min-width:34px; height:28px; border:1px solid #806141; border-radius:15px; background:#4a2c1b; color:#f2deb6; cursor:pointer; }
                .pcnb-nav button:disabled { opacity:.35; cursor:default; }
                @media (max-width:720px), (orientation:portrait) {
                    .pcnb-overlay { padding:10px max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left)); }
                    .pcnb-book { width:100%; height:min(90dvh,760px); padding:13px; border-radius:9px; }
                    .pcnb-pages { grid-template-columns:1fr; }
                    .pcnb-pages::after,.pcnb-page:nth-child(2) { display:none; }
                    .pcnb-page { padding:52px 27px 52px; }
                    .pcnb-close { top:16px; right:16px; }
                    .pcnb-nav { bottom:15px; }
                }
                @media (prefers-reduced-motion:reduce) { .pcnb-overlay { transition:none; } }
            </style>
            <div class="pcnb-overlay" role="dialog" aria-modal="true" aria-label="Notebook reader">
                <div class="pcnb-book">
                    <button class="pcnb-close" type="button" aria-label="Close notebook">×</button>
                    <div class="pcnb-pages"></div>
                    <div class="pcnb-nav">
                        <button class="pcnb-prev" type="button" aria-label="Previous page">‹</button>
                        <span class="pcnb-status"></span>
                        <button class="pcnb-next" type="button" aria-label="Next page">›</button>
                    </div>
                </div>
            </div>`;
        this.overlay = shadow.querySelector('.pcnb-overlay');
        this.pagesElement = shadow.querySelector('.pcnb-pages');
        this.closeButton = shadow.querySelector('.pcnb-close');
        this.prevButton = shadow.querySelector('.pcnb-prev');
        this.nextButton = shadow.querySelector('.pcnb-next');
        this.status = shadow.querySelector('.pcnb-status');
        this.closeButton.addEventListener('click', () => this.onClose?.());
        this.prevButton.addEventListener('click', () => this.changePage(-this.pageStep()));
        this.nextButton.addEventListener('click', () => this.changePage(this.pageStep()));
        this.media = window.matchMedia('(max-width: 720px), (orientation: portrait)');
        this.onMediaChange = () => { this.pageIndex -= this.pageIndex % this.pageStep(); this.render(); };
        this.media.addEventListener?.('change', this.onMediaChange);
        document.body.appendChild(this.host);
        this._disposeLocalization = localizeRoot(this.overlay);
    }

    pageStep() { return this.media?.matches ? 1 : 2; }

    open(config) {
        if (!this.host) return;
        clearTimeout(this.closeTimer);
        this.config = config;
        this.pageIndex = 0;
        this.previousFocus = document.activeElement;
        this.render();
        this.host.style.display = 'block';
        this.host.style.pointerEvents = 'auto';
        requestAnimationFrame(() => this.overlay.classList.add('open'));
        this.closeButton.focus({ preventScroll: true });
    }

    close() {
        if (!this.host || this.host.style.display === 'none') return;
        this.overlay.classList.remove('open');
        this.host.style.pointerEvents = 'none';
        this.closeTimer = setTimeout(() => { if (this.host) this.host.style.display = 'none'; }, 210);
        if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus({ preventScroll: true });
    }

    changePage(delta) {
        const count = this.config?.pages?.length ?? 0;
        this.pageIndex = Math.max(0, Math.min(Math.max(0, count - 1), this.pageIndex + delta));
        this.render();
    }

    render() {
        if (!this.pagesElement || !this.config) return;
        this.host.lang = getLanguage();
        const pages = this.config.pages?.length ? this.config.pages : [{ body: this.config.body ?? '' }];
        const shown = this.pageStep();
        this.pagesElement.replaceChildren();
        for (let offset = 0; offset < shown; offset++) {
            const index = this.pageIndex + offset;
            const data = pages[index];
            const page = document.createElement('section');
            page.className = 'pcnb-page';
            const inner = document.createElement('div');
            inner.className = 'pcnb-page-inner';
            const kicker = document.createElement('div');
            kicker.className = 'pcnb-kicker';
            kicker.textContent = this.config.title ?? t('Notebook');
            const title = document.createElement('h2');
            title.className = 'pcnb-title';
            title.textContent = data?.title ?? this.config.title ?? '';
            const date = document.createElement('div');
            date.className = 'pcnb-date';
            date.textContent = data?.date ?? this.config.date ?? '';
            const body = document.createElement('p');
            body.className = 'pcnb-body';
            body.textContent = data?.body ?? '';
            const number = document.createElement('div');
            number.className = 'pcnb-number';
            number.textContent = data ? String(index + 1) : '';
            inner.append(kicker, title, date, body, number);
            page.append(inner, this.makeNoise());
            this.pagesElement.appendChild(page);
        }
        const end = Math.min(pages.length, this.pageIndex + shown);
        this.status.textContent = `${this.pageIndex + 1}–${end} / ${pages.length}`.replace(`${this.pageIndex + 1}–${this.pageIndex + 1}`, `${this.pageIndex + 1}`);
        this.prevButton.disabled = this.pageIndex === 0;
        this.nextButton.disabled = this.pageIndex + shown >= pages.length;
    }

    makeNoise() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'pcnb-noise');
        const filter = document.createElementNS(ns, 'filter');
        const id = `pcnb-noise-${Math.random().toString(36).slice(2)}`;
        filter.setAttribute('id', id);
        const noise = document.createElementNS(ns, 'feTurbulence');
        noise.setAttribute('type', 'fractalNoise');
        noise.setAttribute('baseFrequency', '.72');
        noise.setAttribute('numOctaves', '3');
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%');
        rect.setAttribute('filter', `url(#${id})`);
        filter.appendChild(noise); svg.append(filter, rect);
        return svg;
    }

    destroy() {
        this._unsubscribeLanguage?.();
        this._disposeLocalization?.();
        clearTimeout(this.closeTimer);
        this.media?.removeEventListener?.('change', this.onMediaChange);
        this.host?.remove();
        this.host = null;
    }
}
