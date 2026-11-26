import { UI_TRANSLATIONS } from './localization-ui.mjs';

export const LANGUAGES = Object.freeze({ en: 'English', ja: '日本語', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', fr: 'Français', es: 'Español', vi: 'Tiếng Việt' });
const storageKey = 'tvroom.language';
const listeners = new Set();
let language = 'en';
try {
    const saved = globalThis.localStorage?.getItem(storageKey);
    if (Object.hasOwn(LANGUAGES, saved)) language = saved;
} catch { /* Language switching also works without storage. */ }

export function getLanguage() { return language; }
export function setLanguage(value) {
    if (!Object.hasOwn(LANGUAGES, value) || value === language) return;
    language = value;
    try { globalThis.localStorage?.setItem(storageKey, value); } catch { /* Optional persistence. */ }
    for (const callback of listeners) callback(value);
}
export function onLanguageChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}
export function t(source) {
    if (language === 'en') return source;
    if (typeof source !== 'string') return source;
    const volume = source.match(/^Set volume to (\d+)%$/);
    if (volume) return t('Set volume to {value}%').replace('{value}', volume[1]);
    const open = source.match(/^Open (.+)$/);
    if (open && !UI_TRANSLATIONS[source]) return t('Open {name}').replace('{name}', open[1]);
    const tab = source.match(/^(Apps|Offline|App) ×$/);
    if (tab) return `${t(tab[1])} ×`;
    return UI_TRANSLATIONS[source]?.[language] ?? source;
}

// Only observes a game's own DOM subtree, never iframe documents, user input,
// URLs or CSS. Remember source text so switching repeatedly is reversible.
export function localizeRoot(root) {
    const sources = new WeakMap();
    const attributes = ['title', 'aria-label', 'placeholder'];
    const translate = (node, key, read, write) => {
        const current = read();
        const record = sources.get(node) ?? {};
        const previous = record[key];
        const source = previous && current === previous.output ? previous.source : current;
        const output = t(source);
        record[key] = { source, output };
        sources.set(node, record);
        if (current !== output) write(output);
    };
    const visit = (node) => {
        if (node.nodeType === 3) {
            if (node.parentElement?.closest('[data-i18n-skip]')) return;
            translate(node, 'text', () => node.nodeValue, value => { node.nodeValue = value; });
            return;
        }
        if (node.nodeType === 1) {
            if (node.matches('script,style,textarea') || node.closest('[data-i18n-skip]')) return;
            for (const attr of attributes) if (node.hasAttribute(attr)) {
                translate(node, attr, () => node.getAttribute(attr), value => node.setAttribute(attr, value));
            }
        }
        for (const child of node.childNodes) visit(child);
    };
    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'childList') for (const node of record.addedNodes) visit(node);
            else visit(record.target);
        }
    });
    const refresh = () => { root.lang = language; visit(root); };
    refresh();
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    const unsubscribe = onLanguageChange(refresh);
    return () => { observer.disconnect(); unsubscribe(); };
}

export function createLanguageControl(parent) {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '8px', marginBottom: '8px', color: '#eee', font: '13px system-ui,sans-serif' });
    const title = document.createElement('span');
    title.textContent = 'Language';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Language');
    select.dataset.i18nSkip = '';
    Object.assign(select.style, { flex: '1', minWidth: '120px', maxWidth: '100%', padding: '8px', borderRadius: '5px', background: '#252525', color: '#fff', border: '1px solid #777', font: '14px system-ui,sans-serif' });
    for (const [code, name] of Object.entries(LANGUAGES)) {
        const option = document.createElement('option');
        option.value = code; option.textContent = name; select.appendChild(option);
    }
    select.value = language;
    const change = () => setLanguage(select.value);
    select.addEventListener('change', change);
    const unsubscribe = onLanguageChange(() => { select.value = language; select.setAttribute('aria-label', t('Language')); });
    select.setAttribute('aria-label', t('Language'));
    label.append(title, select); parent.appendChild(label);
    return () => { unsubscribe(); select.removeEventListener('change', change); label.remove(); };
}
