// One coordinator per application; all 3D sounds retain the engine's own graph.
const coordinators = new WeakMap();

export function getSceneAudio(app) {
    if (!coordinators.has(app)) coordinators.set(app, new SceneAudio(app));
    return coordinators.get(app);
}

class SceneAudio {
    constructor(app) {
        this.app = app;
        this.debug = false;
        this.cleanups = [];
        this.components = new Map();
        this.manager = app.soundManager;
        this.session = globalThis.navigator?.audioSession;
        this.previousSessionType = this.session?.type;
        this.setSessionMode('ambient');
        // Access only the engine-owned context. SoundManager already registers
        // one-shot click/touchstart/mousedown unlock listeners for this context.
        this.context = this.manager?.context;
        const gesture = event => {
            if (!event.isTrusted) return;
            this.log('engine:unlock-gesture', { source: event.type, action: 'engine owns unlock; no extra resume call' });
            window.removeEventListener('touchstart', gesture, true);
            window.removeEventListener('click', gesture, true);
        };
        window.addEventListener('touchstart', gesture, { capture: true, passive: true });
        window.addEventListener('click', gesture, true);
        this.cleanups.push(() => {
            window.removeEventListener('touchstart', gesture, true);
            window.removeEventListener('click', gesture, true);
        });
        this.listen(this.context, 'statechange', () => this.log('context:statechange'));
        this.listen(this.session, 'statechange', () => this.log('session:statechange'));
        this.listen(document, 'visibilitychange', () => this.log('page:visibility', { hidden: document.hidden }));
        for (const name of ['focus', 'blur', 'pageshow', 'pagehide', 'orientationchange']) {
            this.listen(window, name, () => this.log(`page:${name}`));
        }
        for (const name of ['resume', 'suspend']) {
            const handler = () => this.log(`engine:${name}`, { source: document.hidden ? 'hidden-page/engine' : 'engine-or-user' });
            this.manager?.on(name, handler);
            this.cleanups.push(() => this.manager?.off(name, handler));
        }
        const debug = value => this.setDebug(value);
        const mode = value => this.setSessionMode(value);
        app.on('audio:debug', debug); app.on('audio:session-mode', mode);
        this.cleanups.push(() => { app.off('audio:debug', debug); app.off('audio:session-mode', mode); });
        const added = (entity, component) => { if (this.debug) this.watchSound(entity, component); };
        const removed = (entity, component) => this.unwatchSound(component);
        app.systems.sound?.on('add', added);
        app.systems.sound?.on('beforeremove', removed);
        this.cleanups.push(() => {
            app.systems.sound?.off('add', added);
            app.systems.sound?.off('beforeremove', removed);
        });
        app.once('destroy', () => this.destroy());
    }

    listen(target, event, handler) {
        target?.addEventListener?.(event, handler);
        this.cleanups.push(() => target?.removeEventListener?.(event, handler));
    }

    setSessionMode(mode) {
        if (!['ambient', 'auto'].includes(mode)) return;
        this.mode = mode;
        if (this.session) {
            try { if (this.session.type !== mode) this.session.type = mode; }
            catch (error) { console.warn('[SceneAudio] AudioSession configuration failed:', error); }
        }
        this.log('session:configure', { requested: mode });
    }

    log(event, detail = {}) {
        if (!this.debug) return;
        console.info('[AudioDebug]', {
            time: new Date().toISOString(), elapsedMs: Math.round(performance.now()), event,
            context: this.context?.state ?? 'unavailable',
            sessionType: this.session?.type ?? 'unsupported',
            sessionState: this.session?.state ?? 'unsupported', ...detail
        });
    }

    setDebug(value) {
        this.debug = !!value;
        if (this.debug) {
            const visit = entity => {
                if (entity.sound) this.watchSound(entity, entity.sound);
                for (const child of entity.children ?? []) visit(child);
            };
            visit(this.app.root);
            this.log('diagnostics:enabled', { requestedMode: this.mode, unlockOwner: 'PlayCanvas SoundManager' });
        } else {
            for (const component of this.components.keys()) this.unwatchSound(component);
        }
    }

    watchSound(entity, component) {
        if (!component || this.components.has(component)) return;
        const handlers = [];
        for (const event of ['play', 'pause', 'resume', 'stop', 'end']) {
            const handler = (slot, instance) => this.log(`sound:${event}`, {
                entity: entity.name, slot: slot?.name, loop: slot?.loop,
                positional: component.positional, source: 'SoundComponent event',
                playing: instance?.isPlaying
            });
            component.on(event, handler); handlers.push([event, handler]);
        }
        this.components.set(component, handlers);
        for (const [name, slot] of Object.entries(component.slots ?? {})) {
            this.log('sound:snapshot', { entity: entity.name, slot: name, loop: slot.loop,
                positional: component.positional, playing: slot.isPlaying, paused: slot.isPaused,
                volume: slot.volume, distanceModel: component.distanceModel });
        }
    }

    unwatchSound(component) {
        for (const [event, handler] of this.components.get(component) ?? []) component.off(event, handler);
        this.components.delete(component);
    }

    watchMedia(media, label) {
        const events = ['play', 'playing', 'pause', 'ended', 'waiting', 'error', 'volumechange', 'emptied'];
        const handler = event => this.log(`media:${event.type}`, {
            label, paused: media.paused, muted: media.muted, volume: media.volume,
            error: media.error?.code
        });
        for (const event of events) media.addEventListener(event, handler);
        return () => { for (const event of events) media.removeEventListener(event, handler); };
    }

    destroy() {
        for (const component of this.components.keys()) this.unwatchSound(component);
        for (const cleanup of this.cleanups.splice(0)) cleanup();
        try {
            if (this.session && this.session.type === this.mode && this.previousSessionType) {
                this.session.type = this.previousSessionType;
            }
        } catch { /* Session may already be gone during teardown. */ }
        coordinators.delete(this.app);
    }
}
