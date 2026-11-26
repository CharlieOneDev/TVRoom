// @ts-nocheck
import {
    Script,
    Entity,
    Vec3
} from 'playcanvas';
import { WorkPanel } from './work-panel.mjs';
import { getSceneAudio } from './scene-audio.mjs';
import { observeYouTube } from './youtube-audio-diagnostics.mjs';
import { createLanguageControl, localizeRoot } from './localization.mjs';

export class YouTubeScreenOverlay extends Script {
    static scriptName = 'youtubeScreenOverlay';

    /** @type {Map<HTMLElement, { value: string, priority: string }> | null} */
    _cursorStyleSnapshots = null;

    /** @type {HTMLElement | null} */
    videoSoundStateLabel = null;

    /**
     * @attribute
     * @title Camera
     * @type {Entity}
     */
    camera = null;

    /**
     * @attribute
     * @title Mobile Controls Screen
     * @type {Entity}
     */
    mobileControlsScreen = null;

    /**
     * @attribute
     * @title YouTube Video ID
     * @type {string}
     */
    videoId = 'NMZPbYMnUn8';

    /**
     * Comma-separated website URLs shown as apps in Work.
     *
     * @attribute
     * @title Work Whitelist URLs
     */
    whitelistUrls = 'https://example.com,https://example.org,https://example.net';

    /**
     * @attribute
     * @title Online Video URL
     */
    onlineVideoUrl = '';

    // YouTube iframe's internal dimensions.
    playerWidth = 640;
    playerHeight = 360;

    /**
     * @attribute
     * @title Audio Debug
     * @type {boolean}
     */
    audioDebug = false;

    /**
     * @attribute
     * @title Audio Session Mode
     * @type {string}
     */
    audioSessionMode = 'ambient';

    initialize() {
        this.sceneAudio = getSceneAudio(this.app);
        this.sceneAudio.setSessionMode(this.audioSessionMode);
        this.sceneAudio.setDebug(this.audioDebug);
        if (!this.camera || !this.camera.camera) {
            console.error('[YouTubeScreen] Camera reference missing.');
            return;
        }

        if (!this.entity.render) {
            console.error('[YouTubeScreen] Screen needs a Render component.');
            return;
        }

        if (this.entity.render.type !== 'plane') {
            console.error('[YouTubeScreen] Screen must be a Plane.');
            return;
        }

        this.isPopupMode = false;
        this._settingsInteractionActive = false;
        this._wasPointerLocked = !!document.pointerLockElement;
        this._mobileControlsOriginalEnabled = this.mobileControlsScreen
            ? this.mobileControlsScreen.enabled
            : false;

        // Create the YouTube iframe only when TV Controls is opened.
        // Loading a YouTube iframe during scene initialization adds a second
        // heavy web context on mobile Safari and can contribute to reloads.
        this.iframe = null;

        // Bedroom video sound is controlled by the Settings UI through app events.
        // The bedroom-video script owns the actual HTMLVideoElement.
        this._bedroomVideoMuted = true;
        this._bedroomVideoAvailable = false;
        this._bedroomVideoVolume = 0.8;
        this._onBedroomVideoSoundState = (muted, available = true, volume = 0.8) => {
            this._bedroomVideoMuted = !!muted;
            this._bedroomVideoAvailable = !!available;
            const parsedVolume = Number(volume);
            this._bedroomVideoVolume = Number.isFinite(parsedVolume)
                ? Math.min(1, Math.max(0, parsedVolume))
                : 0.8;
            this.updateBedroomVideoSoundButton();
            this.updateBedroomVideoVolumeControl();
        };
        this.app.on('bedroom-video:sound-state', this._onBedroomVideoSoundState, this);

        this._onBedroomVideoUrlsState = (urls) => {
            if (typeof urls === 'string' && document.activeElement !== this.bedroomVideoUrlInput) {
                this.bedroomVideoUrlInput.value = urls;
            }
        };
        this.app.on('bedroom-video:urls-state', this._onBedroomVideoUrlsState, this);

        // Build the Settings UI after the iframe exists.
        this.createHtmlControls();
        this._disposeLocalization = localizeRoot(this.overlayRoot);
        this.workPanel = new WorkPanel({
            onOpen: () => this.setWorkBrowserActive(true),
            onClose: () => this.setWorkBrowserActive(false),
            whitelistUrls: this.whitelistUrls
        });
        this.syncPointerLockState();
        this.app.fire('bedroom-video:request-sound-state');
        this.app.fire('bedroom-video:request-urls-state');

        // Default PlayCanvas Plane geometry is in the local XZ plane.
        // This ordering assumes the screen entity is rotated 90 degrees around X.
        this.localCorners = [
            new Vec3(-0.5, 0, -0.5), // Top left
            new Vec3( 0.5, 0, -0.5), // Top right
            new Vec3( 0.5, 0,  0.5), // Bottom right
            new Vec3(-0.5, 0,  0.5)  // Bottom left
        ];

        this.worldCorners = [
            new Vec3(),
            new Vec3(),
            new Vec3(),
            new Vec3()
        ];

        this.projected = new Vec3();
        this.viewPoint = new Vec3();

        console.log('[YouTubeScreen] Player created:', this.videoId);

        // Keep the default automatic preload, but only after the first scene
        // frame is visible so it cannot block the mobile loading screen.
        this._youtubeLoadTimer = null;
        this._onFirstSceneFrame = () => {
            this._youtubeLoadTimer = window.setTimeout(() => {
                this._youtubeLoadTimer = null;
                this.createYouTubeIframe();
            }, 1500);
        };
        this.app.once('postrender', this._onFirstSceneFrame, this);

    }

    createHtmlControls() {
        // Dimmed background behind the TV submenu.
        this.popupBackdrop = document.createElement('div');
        Object.assign(this.popupBackdrop.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0, 0, 0, 0.65)',
            zIndex: '999998',
            display: 'none',
            pointerEvents: 'auto'
        });
        document.body.appendChild(this.popupBackdrop);

        // Full-screen overlay. Only its actual controls receive pointer events.
        this.overlayRoot = document.createElement('div');
        Object.assign(this.overlayRoot.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '1000000',
            pointerEvents: 'none',
            fontFamily: 'Arial, sans-serif'
        });
        document.body.appendChild(this.overlayRoot);

        // One persistent top-left Settings button, with ESC shown as a hint.
        // It remains visible during gameplay. While Pointer Lock is active,
        // it is visual-only; pressing ESC releases Pointer Lock and opens Settings.
        this.settingsButton = document.createElement('button');
        this.settingsButton.type = 'button';
        this.settingsButton.setAttribute('aria-label', 'Settings. Press Escape on desktop.');
        this.settingsButton.title = 'Settings (ESC)';
        this.settingsButton.innerHTML = `
            <span class="settings-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24"
                    fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M19.14 12.94c.04-.3.06-.62.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.28 7.28 0 0 0-1.69-.96L14.3 2.7a.5.5 0 0 0-.5-.42h-3.6a.5.5 0 0 0-.5.42L9.34 5.3c-.61.24-1.18.57-1.69.96l-2.39-.96a.5.5 0 0 0-.61.22L2.73 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.51.39 1.08.72 1.69.96l.36 2.6a.5.5 0 0 0 .5.42h3.6a.5.5 0 0 0 .5-.42l.36-2.6c.61-.24 1.18-.57 1.69-.96l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/>
                </svg>
            </span>
            <span class="settings-label">SETTINGS</span>
            <kbd class="settings-esc-key">ESC</kbd>
        `;
        const settingsIcon = this.settingsButton.querySelector('.settings-icon');
        if (settingsIcon instanceof HTMLElement) {
            Object.assign(settingsIcon.style, {
                width: '24px',
                height: '24px',
                flex: '0 0 24px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: '0',
                margin: '0',
                padding: '0'
            });
            const iconSvg = settingsIcon.querySelector('svg');
            if (iconSvg instanceof SVGElement) {
                Object.assign(iconSvg.style, {
                    display: 'block',
                    width: '20px',
                    height: '20px',
                    flex: '0 0 20px',
                    margin: '0',
                    padding: '0'
                });
            }
        }

        Object.assign(this.settingsButton.style, {
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
            left: 'calc(env(safe-area-inset-left, 0px) + 14px)',
            minWidth: '132px',
            height: '46px',
            padding: '0 11px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '9px',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '11px',
            background: 'rgba(15,15,15,0.72)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '700',
            letterSpacing: '0.6px',
            cursor: 'pointer',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
            boxSizing: 'border-box',
            zIndex: '2'
        });

        const escKey = this.settingsButton.querySelector('.settings-esc-key');
        if (escKey instanceof HTMLElement) {
            Object.assign(escKey.style, {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '31px',
                height: '25px',
                padding: '0 5px',
                border: '1px solid rgba(255,255,255,0.35)',
                borderRadius: '5px',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: '700',
                lineHeight: '1',
                boxSizing: 'border-box'
            });
        }
        this.overlayRoot.appendChild(this.settingsButton);

        // Main Settings menu. The Settings button stays visible above it.
        this.settingsPanel = document.createElement('div');
        Object.assign(this.settingsPanel.style, {
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 68px)',
            left: 'calc(env(safe-area-inset-left, 0px) + 14px)',
            width: '230px',
            maxWidth: 'calc(100vw - 28px)',
            maxHeight: 'calc(100dvh - 82px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
            padding: '12px',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: '12px',
            background: 'rgba(20,20,20,0.96)',
            color: '#fff',
            display: 'none',
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,.3) transparent',
            pointerEvents: 'auto',
            touchAction: 'pan-y',
            boxShadow: '0 10px 35px rgba(0,0,0,0.4)',
            boxSizing: 'border-box'
        });

        const settingsTitle = document.createElement('div');
        settingsTitle.textContent = 'SETTINGS';
        Object.assign(settingsTitle.style, {
            padding: '5px 8px 12px',
            fontSize: '11px',
            fontWeight: '700',
            letterSpacing: '1.2px',
            color: 'rgba(255,255,255,0.58)'
        });
        this.settingsPanel.appendChild(settingsTitle);
        this._disposeLanguageControl = createLanguageControl(this.settingsPanel);
        const cursorHint = document.createElement('div');
        cursorHint.textContent = 'TAB: SHOW CURSOR';
        Object.assign(cursorHint.style, { margin: '-7px 8px 10px', fontSize: '10px', fontWeight: '700', letterSpacing: '.7px', color: 'rgba(255,255,255,.42)' });
        this.settingsPanel.appendChild(cursorHint);

        // Bedroom video sound toggle. The video script handles playback and
        // reports the actual mute state back through the app event system.
        this.videoSoundButton = document.createElement('button');
        this.videoSoundButton.type = 'button';
        this.videoSoundButton.setAttribute('aria-label', 'Toggle bedroom video sound');
        this.videoSoundButton.setAttribute('aria-pressed', 'false');
        this.videoSoundButton.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path class="music-mute-slash" d="M3 3 21 21"/></svg>';
        this.videoSoundMuteSlash = this.videoSoundButton.querySelector('.music-mute-slash');
        Object.assign(this.videoSoundButton.style, {
            width: '46px',
            minHeight: '46px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 9px',
            marginBottom: '8px',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: '14px',
            textAlign: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            boxSizing: 'border-box'
        });
        this.settingsPanel.appendChild(this.videoSoundButton);
        this.updateBedroomVideoSoundButton();

        this.videoVolumeControl = document.createElement('div');
        Object.assign(this.videoVolumeControl.style, {
            width: '100%',
            marginTop: '-2px',
            marginBottom: '8px',
            padding: '9px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.06)',
            boxSizing: 'border-box'
        });

        this.videoVolumeSlider = document.createElement('input');
        this.videoVolumeSlider.type = 'range';
        this.videoVolumeSlider.min = '0';
        this.videoVolumeSlider.max = '100';
        this.videoVolumeSlider.step = '1';
        this.videoVolumeSlider.value = '80';
        this.videoVolumeSlider.setAttribute('aria-label', 'Bedroom video volume');
        Object.assign(this.videoVolumeSlider.style, {
            display: 'none'
        });
        this.videoVolumeSteps = document.createElement('div');
        Object.assign(this.videoVolumeSteps.style, { display: 'flex', alignItems: 'end', gap: '5px', height: '30px' });
        for (const [index, value] of [0, 25, 50, 75, 100].entries()) {
            const step = document.createElement('button'); step.type = 'button'; step.title = `Set volume to ${value}%`; step.setAttribute('aria-label', step.title); step.dataset.volume = String(value);
            Object.assign(step.style, { flex: '1', height: `${8 + index * 5}px`, padding: '0', border: '0', borderRadius: '2px', background: 'rgba(255,255,255,.24)', cursor: 'pointer' });
            step.addEventListener('click', () => this.setBedroomVideoVolume(value / 100)); this.videoVolumeSteps.appendChild(step);
        }
        this.videoVolumeControl.append(this.videoVolumeSlider, this.videoVolumeSteps);
        this.settingsPanel.appendChild(this.videoVolumeControl);
        this.updateBedroomVideoVolumeControl();

        this.bedroomVideoAssetControl = document.createElement('div');
        Object.assign(this.bedroomVideoAssetControl.style, {
            width: '100%',
            marginBottom: '8px',
            padding: '9px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.06)',
            boxSizing: 'border-box'
        });

        const assetTitle = document.createElement('div');
        assetTitle.setAttribute('aria-label', 'Bedroom video URLs');
        assetTitle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/><path d="m7 10 3 2-3 2"/></svg>';
        Object.assign(assetTitle.style, {
            marginBottom: '7px', display: 'flex', alignItems: 'center', height: '22px',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.78)'
        });

        this.bedroomVideoUrlInput = document.createElement('textarea');
        this.bedroomVideoUrlInput.rows = 3;
        this.bedroomVideoUrlInput.placeholder = 'https://example.com/a.mp4, https://example.com/b.mp4';
        this.bedroomVideoUrlInput.setAttribute('aria-label', 'Bedroom video URLs');
        Object.assign(this.bedroomVideoUrlInput.style, {
            width: '100%',
            minHeight: '54px',
            resize: 'vertical',
            marginBottom: '7px',
            padding: '7px',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '6px',
            background: 'rgba(15,15,15,0.95)',
            color: '#fff',
            fontSize: '11px',
            lineHeight: '1.35',
            boxSizing: 'border-box'
        });

        this.bedroomVideoUrlInput.addEventListener('change', () => {
            this.app.fire('bedroom-video:set-urls', this.bedroomVideoUrlInput.value);
        });

        this.bedroomVideoFileInput = document.createElement('input');
        this.bedroomVideoFileInput.type = 'file';
        this.bedroomVideoFileInput.accept = 'video/*';
        this.bedroomVideoFileInput.setAttribute('aria-label', 'Choose local bedroom video');
        Object.assign(this.bedroomVideoFileInput.style, {
            position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none'
        });
        this.bedroomVideoUploadButton = document.createElement('button'); this.bedroomVideoUploadButton.type = 'button'; this.bedroomVideoUploadButton.setAttribute('aria-label', 'Upload local bedroom video'); this.bedroomVideoUploadButton.title = 'Upload local bedroom video';
        this.bedroomVideoUploadButton.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/></svg>';
        Object.assign(this.bedroomVideoUploadButton.style, { width: '38px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.2)', borderRadius: '6px', background: 'rgba(255,255,255,.1)', color: '#fff', cursor: 'pointer' });
        this.bedroomVideoFileName = document.createElement('div'); Object.assign(this.bedroomVideoFileName.style, { display: 'none', alignItems: 'center', gap: '6px', marginTop: '7px', fontSize: '11px', color: 'rgba(255,255,255,.86)' }); this.bedroomVideoFileLabel = document.createElement('span'); Object.assign(this.bedroomVideoFileLabel.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        this.bedroomVideoClearButton = document.createElement('button'); this.bedroomVideoClearButton.type = 'button'; this.bedroomVideoClearButton.textContent = '×'; this.bedroomVideoClearButton.setAttribute('aria-label', 'Remove local bedroom video'); Object.assign(this.bedroomVideoClearButton.style, { width: '22px', height: '22px', padding: '0', border: '0', borderRadius: '50%', background: 'rgba(255,255,255,.13)', color: '#fff', cursor: 'pointer' });
        this.bedroomVideoFileLabel.dataset.i18nSkip = '';
        this.bedroomVideoFileName.append(this.bedroomVideoFileLabel, this.bedroomVideoClearButton);

        this.bedroomVideoAssetControl.appendChild(assetTitle);
        this.bedroomVideoAssetControl.appendChild(this.bedroomVideoUrlInput);
        this.bedroomVideoAssetControl.appendChild(this.bedroomVideoFileInput);
        this.bedroomVideoAssetControl.appendChild(this.bedroomVideoUploadButton);
        this.bedroomVideoAssetControl.appendChild(this.bedroomVideoFileName);
        this.settingsPanel.appendChild(this.bedroomVideoAssetControl);

        this.onlineVideoControl = document.createElement('div');
        Object.assign(this.onlineVideoControl.style, {
            flex: '1 1 auto',
            minWidth: '0',
            marginBottom: '8px',
            padding: '9px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.06)',
            boxSizing: 'border-box'
        });

        this.onlineVideoUrlInput = document.createElement('input');
        this.onlineVideoUrlInput.type = 'url';
        this.onlineVideoUrlInput.value = this.onlineVideoUrl;
        this.onlineVideoUrlInput.placeholder = 'YouTube link or https://...';
        this.onlineVideoUrlInput.setAttribute('aria-label', 'Online video URL');
        Object.assign(this.onlineVideoUrlInput.style, {
            width: '100%',
            height: '34px',
            padding: '7px',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '6px',
            background: 'rgba(15,15,15,0.95)',
            color: '#fff',
            fontSize: '11px',
            boxSizing: 'border-box'
        });
        this.onlineVideoUrlInput.addEventListener('change', () => {
            this.setOnlineVideoUrl(this.onlineVideoUrlInput.value);
        });

        this.onlineVideoControl.appendChild(this.onlineVideoUrlInput);

        // First submenu: TV Controls.
        this.tvControlsButton = document.createElement('button');
        this.tvControlsButton.type = 'button';
        this.tvControlsButton.setAttribute('aria-label', 'TV Controls');
        this.tvControlsButton.innerHTML = `
            <svg width="21" height="21" viewBox="0 0 24 24"
                fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="13" rx="2"/>
                <path d="M8 22h8M12 18v4"/>
                <path d="m9 2 3 3 3-3"/>
            </svg>
        `;
        Object.assign(this.tvControlsButton.style, {
            width: '46px',
            minHeight: '46px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 9px',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: '14px',
            textAlign: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
            boxSizing: 'border-box'
        });
        this.tvOnlineRow = document.createElement('div');
        Object.assign(this.tvOnlineRow.style, { width: '100%', display: 'flex', alignItems: 'stretch', gap: '8px', marginBottom: '8px', boxSizing: 'border-box' });
        this.tvControlsButton.style.marginBottom = '0';
        this.onlineVideoControl.style.marginBottom = '0';
        this.tvOnlineRow.append(this.tvControlsButton, this.onlineVideoControl);
        this.settingsPanel.appendChild(this.tvOnlineRow);

        this.workButton = document.createElement('button');
        this.workButton.type = 'button';
        this.workButton.setAttribute('aria-label', 'Open Work');
        this.workButton.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21"/></svg>';
        Object.assign(this.workButton.style, {
            width: '46px', minHeight: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '10px 9px', marginTop: '8px', border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: '#fff',
            fontSize: '14px', textAlign: 'center', cursor: 'pointer', touchAction: 'manipulation',
            boxSizing: 'border-box'
        });
        this.workEntry = document.createElement('div');
        Object.assign(this.workEntry.style, { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '8px' });
        this.workButton.style.marginTop = '0';
        this.workBetaBadge = document.createElement('span');
        this.workBetaBadge.textContent = 'BETA';
        Object.assign(this.workBetaBadge.style, { padding: '3px 6px', border: '1px solid rgba(255,255,255,.28)', borderRadius: '4px', color: 'rgba(255,255,255,.68)', fontSize: '9px', fontWeight: '700', letterSpacing: '.7px', lineHeight: '1' });
        this.workEntry.append(this.workButton, this.workBetaBadge);
        this.settingsPanel.appendChild(this.workEntry);
        this.overlayRoot.appendChild(this.settingsPanel);

        // Back button for the TV submenu; returns to the Settings menu.
        this.closeButton = document.createElement('button');
        this.closeButton.type = 'button';
        this.closeButton.textContent = '←  BACK TO SETTINGS';
        this.closeButton.setAttribute('aria-label', 'Back to Settings');
        Object.assign(this.closeButton.style, {
            position: 'fixed',
            top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
            left: 'calc(env(safe-area-inset-left, 0px) + 14px)',
            minHeight: '46px',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: '1',
            boxSizing: 'border-box',
            padding: '0 15px',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '10px',
            background: 'rgba(15,15,15,0.9)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '700',
            letterSpacing: '0.4px',
            cursor: 'pointer',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
            zIndex: '2',
            height: '46px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
        });
        this.overlayRoot.appendChild(this.closeButton);

        // Keep menu input separate from game-level click handlers. Button
        // handlers on the controls still run; bubbling is stopped only after
        // the target control has processed its click.
        this._stopSettingsClickBubble = (event) => {
            if (this._settingsInteractionActive) event.stopPropagation();
        };
        this.overlayRoot.addEventListener('click', this._stopSettingsClickBubble);

        // User interaction: mouse click on desktop or tap on touch devices.
        this.settingsButton.addEventListener('click', () => {
            if (this.isPopupMode) return;
            this.toggleSettings();
        });

        this.videoSoundButton.addEventListener('click', () => {
            this.setBedroomVideoMuted(!this._bedroomVideoMuted);
        });

        this.videoVolumeSlider.addEventListener('input', () => {
            const volume = Math.min(1, Math.max(0, parseFloat(this.videoVolumeSlider.value) / 100));
            this.setBedroomVideoVolume(volume);
        });

        this.bedroomVideoFileInput.addEventListener('change', () => {
            const file = this.bedroomVideoFileInput.files?.[0];
            if (!file) return;

            if (this._selectedBedroomBlobUrl) URL.revokeObjectURL(this._selectedBedroomBlobUrl);
            const blobUrl = URL.createObjectURL(file);
            this._selectedBedroomBlobUrl = blobUrl;
            this.app.fire('bedroom-video:set-asset', blobUrl);
            this.bedroomVideoFileLabel.textContent = file.name;
            this.bedroomVideoFileName.style.display = 'flex';
        });
        this.bedroomVideoUploadButton.addEventListener('click', () => this.bedroomVideoFileInput.click());
        this.bedroomVideoClearButton.addEventListener('click', () => {
            this.bedroomVideoFileInput.value = '';
            this.bedroomVideoFileLabel.textContent = '';
            this.bedroomVideoFileName.style.display = 'none';
            if (this._selectedBedroomBlobUrl) {
                URL.revokeObjectURL(this._selectedBedroomBlobUrl);
                this._selectedBedroomBlobUrl = null;
            }
            this.app.fire('bedroom-video:clear-local-file');
        });

        this.tvControlsButton.addEventListener('click', () => {
            this.enterPopupMode();
        });

        this.workButton.addEventListener('click', () => {
            this.closeSettings();
            this.workPanel?.open();
        });

        this.closeButton.addEventListener('click', () => {
            this.exitPopupMode();
        });

        // Pointer Lock is used only as the desktop ESC -> Settings transition.
        this._onPointerLockChange = () => {
            // Every Settings layer owns the pointer. If another game script
            // tries to lock it again, immediately release it and keep the UI
            // cursor available. This applies to the main menu AND TV Controls.
            if (this._settingsInteractionActive || this.isPopupMode) {
                if (document.pointerLockElement) {
                    this.releasePointerLock?.();
                } else {
                    this.applyPointerCursorStyles?.();
                }
                return;
            }

            this.syncPointerLockState();
        };
        document.addEventListener('pointerlockchange', this._onPointerLockChange);

        // Stop game-canvas input while a Settings layer is open. The overlay
        // and YouTube iframe live outside the canvas, so their own controls
        // remain interactive. This prevents canvas click handlers from
        // immediately reacquiring Pointer Lock after ESC has opened the menu.
        this._onCanvasInputWhileSettingsOpen = (event) => {
            if (!this._settingsInteractionActive) return;

            const canvas = this.app.graphicsDevice?.canvas;
            if (!canvas) return;

            const target = event.target;
            if (target === canvas || (target instanceof Node && canvas.contains(target))) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') {
                    event.stopImmediatePropagation();
                }
            }
        };
        document.addEventListener('pointerdown', this._onCanvasInputWhileSettingsOpen, true);
        document.addEventListener('mousedown', this._onCanvasInputWhileSettingsOpen, true);
        document.addEventListener('touchstart', this._onCanvasInputWhileSettingsOpen, { capture: true, passive: false });

        // ESC behavior:
        // - While locked, let the browser release Pointer Lock. The resulting
        //   pointerlockchange event opens Settings.
        // - While unlocked, ESC opens Settings or closes the current Settings layer.
        this._onKeyDown = (event) => {
            const isEditableTarget = event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLSelectElement ||
                (event.target instanceof HTMLElement && event.target.isContentEditable);

            // Tab is a cursor-only escape hatch for normal gameplay. Unlike
            // ESC it must not open Settings; the next game click still follows
            // the existing pointer-lock behavior.
            if (event.key === 'Tab' && !event.repeat && !isEditableTarget &&
                !this.isSettingsOpen() && !this.isPopupMode) {
                event.preventDefault();
                if (document.pointerLockElement) {
                    this._tabReleasedPointerLock = true;
                    this.releasePointerLock?.();
                }
                return;
            }

            // M toggles bedroom-video audio only while the Settings menu is open.
            // This avoids stealing the key from normal gameplay controls.
            if (event.key && event.key.toLowerCase() === 'm' && !event.repeat &&
                this.isSettingsOpen() && !this.isPopupMode &&
                !isEditableTarget) {
                event.preventDefault();
                this.setBedroomVideoMuted(!this._bedroomVideoMuted);
                return;
            }

            if (event.key !== 'Escape' || event.repeat) return;
            if (document.pointerLockElement) return;

            if (this.isPopupMode) {
                event.preventDefault();
                this.exitPopupMode();
                return;
            }

            event.preventDefault();
            if (this.isSettingsOpen()) {
                this.closeSettings();
            } else {
                this.openSettings();
            }
        };
        document.addEventListener('keydown', this._onKeyDown, true);

        // Keep the popup sized correctly after resize / orientation changes.
        this._onViewportResize = () => {
            this.layoutSettingsPanel();
            if (this.isPopupMode) {
                this.layoutPopupIframe();
            }
        };
        window.addEventListener('resize', this._onViewportResize);
        window.addEventListener('orientationchange', this._onViewportResize);
        window.visualViewport?.addEventListener('resize', this._onViewportResize);
        window.visualViewport?.addEventListener('scroll', this._onViewportResize);
        this.layoutSettingsPanel();
    }

    createYouTubeIframe() {
        if (this.iframe) return this.iframe;

        const iframe = document.createElement('iframe');
        iframe.src = this.getActiveVideoUrl();

        iframe.width = String(this.playerWidth);
        iframe.height = String(this.playerHeight);
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';

        Object.assign(iframe.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '200px',
            height: '200px',
            border: '0',
            margin: '0',
            padding: '0',
            transform: 'none',
            transformOrigin: '0 0',
            zIndex: '0',
            opacity: '0.001',
            visibility: 'visible',
            pointerEvents: 'none',
            background: '#000000'
        });

        document.body.appendChild(iframe);
        this.iframe = iframe;
        this._disposeYouTubeDiagnostics = observeYouTube(iframe, this.sceneAudio);
        return iframe;
    }

    getActiveVideoUrl() {
        return this.toEmbeddableVideoUrl(this.onlineVideoUrl || this.videoId);
    }

    toEmbeddableVideoUrl(value) {
        const source = String(value || '').trim();
        const origin = encodeURIComponent(window.location.origin);
        const youtubeEmbedUrl = (id) =>
            `https://www.youtube.com/embed/${encodeURIComponent(id)}` +
            `?autoplay=1&mute=1&controls=1&playsinline=1` +
            `&rel=0&enablejsapi=1&origin=${origin}`;

        // Keep compatibility with the original bare YouTube Video ID field.
        if (/^[\w-]{6,}$/.test(source)) return youtubeEmbedUrl(source);

        try {
            const url = new URL(source);
            if (!/^https?:$/.test(url.protocol)) throw new Error('Unsupported protocol');

            const host = url.hostname.toLowerCase().replace(/^www\./, '');
            if (host === 'youtu.be') {
                return youtubeEmbedUrl(url.pathname.split('/').filter(Boolean)[0] || '');
            }
            if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
                const pathParts = url.pathname.split('/').filter(Boolean);
                const videoId = url.searchParams.get('v') ||
                    (['embed', 'shorts', 'live'].includes(pathParts[0]) ? pathParts[1] : '');
                return videoId ? youtubeEmbedUrl(videoId) : url.href;
            }

            // Other HTTPS video/player URLs are used directly. The host must
            // permit iframe embedding (X-Frame-Options / CSP can forbid it).
            return url.href;
        } catch (error) {
            console.warn('[YouTubeScreen] Invalid online video URL; using the default Video ID.', source);
            return youtubeEmbedUrl(this.videoId);
        }
    }

    setOnlineVideoUrl(value) {
        this.onlineVideoUrl = String(value || '').trim();
        if (this.onlineVideoUrlInput && this.onlineVideoUrlInput.value !== this.onlineVideoUrl) {
            this.onlineVideoUrlInput.value = this.onlineVideoUrl;
        }

        if (this.iframe) {
            const next = this.getActiveVideoUrl();
            if (this.iframe.src !== next) {
                this.sceneAudio.log('youtube:source-change', { source: 'user video URL selection' });
                this.iframe.src = next;
            }
        }
    }

    setBedroomVideoMuted(muted) {
        this._bedroomVideoMuted = !!muted;
        this.updateBedroomVideoSoundButton();
        this.app.fire('bedroom-video:set-muted', this._bedroomVideoMuted);
    }

    setBedroomVideoVolume(volume) {
        const nextVolume = Math.min(1, Math.max(0, Number(volume) || 0));
        this._bedroomVideoVolume = nextVolume;
        this.updateBedroomVideoVolumeControl();
        this.app.fire('bedroom-video:set-volume', nextVolume);
    }

    updateBedroomVideoSoundButton() {
        if (!this.videoSoundButton) return;

        const soundOn = !this._bedroomVideoMuted;
        this.videoSoundButton.setAttribute('aria-pressed', String(soundOn));
        this.videoSoundButton.setAttribute(
            'aria-label',
            soundOn ? 'Turn bedroom video sound off' : 'Turn bedroom video sound on'
        );
        this.videoSoundButton.style.color = soundOn ? '#9ee6b0' : '#fff';
        if (this.videoSoundMuteSlash) this.videoSoundMuteSlash.style.display = soundOn ? 'none' : 'block';
    }

    updateBedroomVideoVolumeControl() {
        if (!this.videoVolumeSteps) return;

        const volumePercent = Math.round(this._bedroomVideoVolume * 100);
        this.videoVolumeSlider.value = String(volumePercent);
        for (const button of this.videoVolumeSteps.querySelectorAll('button')) {
            const active = Number(button.dataset.volume) <= volumePercent;
            button.style.background = active ? '#9ee6b0' : 'rgba(255,255,255,.24)';
        }
    }

    isSettingsOpen() {
        return !!this.settingsPanel && this.settingsPanel.style.display !== 'none';
    }

    layoutSettingsPanel() {
        if (!this.settingsPanel) return;

        const viewport = window.visualViewport;
        const offsetTop = viewport?.offsetTop ?? 0;
        const offsetLeft = viewport?.offsetLeft ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        const availableWidth = Math.max(160, Math.floor(width) - 28);
        const availableHeight = Math.max(96, Math.floor(height) - 82);

        Object.assign(this.settingsPanel.style, {
            top: `calc(env(safe-area-inset-top, 0px) + ${Math.round(offsetTop) + 68}px)`,
            left: `calc(env(safe-area-inset-left, 0px) + ${Math.round(offsetLeft) + 14}px)`,
            maxWidth: `max(160px, calc(${availableWidth}px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`,
            maxHeight: `max(96px, calc(${availableHeight}px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)))`
        });
    }

    openSettings() {
        if (this.isPopupMode || !this.settingsPanel) return;

        this.layoutSettingsPanel();
        this.settingsPanel.style.display = 'block';
        this.settingsButton.style.pointerEvents = 'auto';
        this.setSettingsInteractionMode(true);
        this.app.fire('bedroom-video:request-sound-state');
    }

    closeSettings() {
        if (!this.settingsPanel) return;

        this.settingsPanel.style.display = 'none';
        this.setSettingsInteractionMode(false);
    }

    toggleSettings() {
        if (this.isSettingsOpen()) {
            this.closeSettings();
        } else {
            this.openSettings();
        }
    }

    syncPointerLockState() {
        if (!this.settingsButton || this._settingsInteractionActive || this.isPopupMode) {
            return;
        }

        const locked = !!document.pointerLockElement;
        if (locked) {
            this._wasPointerLocked = true;
            this.settingsButton.style.pointerEvents = 'none';
            this.closeSettings();
            return;
        }

        const wasLocked = this._wasPointerLocked;
        this._wasPointerLocked = false;
        this.settingsButton.style.pointerEvents = 'auto';

        // ESC opens Settings after leaving Pointer Lock. Tab only makes the
        // cursor visible, so it intentionally returns to normal mouse mode.
        const releasedByTab = !!this._tabReleasedPointerLock;
        this._tabReleasedPointerLock = false;
        if (wasLocked && !releasedByTab && document.visibilityState === 'visible') {
            this.openSettings();
        }
    }

    setSettingsInteractionMode(active) {
        this._settingsInteractionActive = !!active;

        const canvas = this.app.graphicsDevice?.canvas;
        const mouse = this.app.mouse;
        if (this._settingsInteractionActive) {
            // Guard PlayCanvas' own pointer-lock entry point as well. This
            // prevents a room/player script from re-locking the mouse when a
            // menu button is clicked while the Settings UI owns interaction.
            if (mouse && typeof mouse.enablePointerLock === 'function' && !this._mousePointerLockSnapshot) {
                const original = mouse.enablePointerLock;
                this._mousePointerLockSnapshot = {
                    hadOwnProperty: Object.prototype.hasOwnProperty.call(mouse, 'enablePointerLock'),
                    original
                };
                mouse.enablePointerLock = (...args) => {
                    if (this._settingsInteractionActive) return;
                    return original.apply(mouse, args);
                };
            }

            if (canvas && !this._canvasPointerEventsSnapshot) {
                this._canvasPointerEventsSnapshot = {
                    value: canvas.style.getPropertyValue('pointer-events'),
                    priority: canvas.style.getPropertyPriority('pointer-events')
                };
            }

            // Keep the game canvas from receiving clicks while a menu is open.
            // HTML menus and the iframe are siblings of the canvas, so they
            // continue receiving mouse/touch events normally.
            if (canvas) {
                canvas.style.setProperty('pointer-events', 'none', 'important');
            }

            this.applyPointerCursorStyles?.();
            this.ensureSettingsCursorVisible?.();
            this.releasePointerLock?.();
            this.scheduleCursorGuard?.();
        } else {
            this.clearCursorGuard?.();

            if (canvas && this._canvasPointerEventsSnapshot) {
                const snapshot = this._canvasPointerEventsSnapshot;
                if (snapshot.value) {
                    canvas.style.setProperty('pointer-events', snapshot.value, snapshot.priority);
                } else {
                    canvas.style.removeProperty('pointer-events');
                }
                this._canvasPointerEventsSnapshot = null;
            }

            this.restorePointerCursorStyles?.();

            if (mouse && this._mousePointerLockSnapshot) {
                if (this._mousePointerLockSnapshot.hadOwnProperty) {
                    mouse.enablePointerLock = this._mousePointerLockSnapshot.original;
                } else {
                    delete mouse.enablePointerLock;
                }
                this._mousePointerLockSnapshot = null;
            }
        }
    }

    setWorkBrowserActive(active) {
        active = !!active;
        if (this._workBrowserActive === active) return;
        this._workBrowserActive = active;

        if (active) {
            this._workMobileControlsSnapshot = this.mobileControlsScreen
                ? this.mobileControlsScreen.enabled
                : null;
            this.setSettingsInteractionMode(true);
            if (this.mobileControlsScreen) this.mobileControlsScreen.enabled = false;
            this.app.fire('work-browser:active', true);
            // Work is a DOM overlay, not a scene pause. Keep video textures
            // rendering and leave the YouTube iframe in its in-world position.
            this.sceneAudio?.log('work:opened', {
                source: 'Work UI', action: 'keep-rendering-and-playing',
                autoRender: this.app.autoRender
            });
            return;
        }

        this.app.renderNextFrame = true;
        this.app.fire('work-browser:active', false);
        if (this.mobileControlsScreen && this._workMobileControlsSnapshot !== null) {
            this.mobileControlsScreen.enabled = this._workMobileControlsSnapshot;
        }
        this._workMobileControlsSnapshot = null;
        this.setSettingsInteractionMode(false);
        this.sceneAudio?.log('work:closed', { source: 'Work UI', action: 'keep-playing' });
    }

    applyPointerCursorStyles() {
        if (!this._cursorStyleSnapshots) this._cursorStyleSnapshots = new Map();

        const canvas = this.app.graphicsDevice?.canvas;
        const elements = [document.documentElement, document.body, canvas, this.popupBackdrop, this.iframe];
        if (this.overlayRoot) elements.push(this.overlayRoot, ...Array.from(this.overlayRoot.querySelectorAll('*')));

        for (const element of elements) {
            if (!(element instanceof HTMLElement)) continue;
            if (!this._cursorStyleSnapshots.has(element)) {
                this._cursorStyleSnapshots.set(element, {
                    value: element.style.getPropertyValue('cursor'),
                    priority: element.style.getPropertyPriority('cursor')
                });
            }
            const isButton = element instanceof HTMLButtonElement || !!element.closest('button');
            element.style.setProperty('cursor', isButton ? 'pointer' : 'default', 'important');
        }
    }

    restorePointerCursorStyles() {
        if (!this._cursorStyleSnapshots) return;
        for (const [element, snapshot] of this._cursorStyleSnapshots) {
            if (snapshot.value) element.style.setProperty('cursor', snapshot.value, snapshot.priority);
            else element.style.removeProperty('cursor');
        }
        this._cursorStyleSnapshots.clear();
    }

    ensureSettingsCursorVisible() {
        const canvas = this.app.graphicsDevice?.canvas;
        for (const element of [document.documentElement, document.body, canvas]) {
            if (element instanceof HTMLElement) {
                element.style.setProperty('cursor', 'default', 'important');
            }
        }
    }

    scheduleCursorGuard() {
        this.clearCursorGuard?.();
        this._cursorGuardTimer = window.setInterval(() => {
            if (this._settingsInteractionActive) {
                this.applyPointerCursorStyles?.();
                this.ensureSettingsCursorVisible?.();
            }
        }, 250);
    }

    clearCursorGuard() {
        if (this._cursorGuardTimer) {
            window.clearInterval(this._cursorGuardTimer);
            this._cursorGuardTimer = null;
        }
    }

    releasePointerLock() {
        this.app.mouse?.disablePointerLock?.();
        if (document.pointerLockElement && document.exitPointerLock) {
            document.exitPointerLock();
        }
        this.applyPointerCursorStyles?.();
    }

    solveHomography(points) {
        const w = this.playerWidth;
        const h = this.playerHeight;
        const source = [[0, 0], [w, 0], [w, h], [0, h]];
        const matrix = [];
        const values = [];

        for (let i = 0; i < 4; i++) {
            const x = source[i][0];
            const y = source[i][1];
            const u = points[i].x;
            const v = points[i].y;

            matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
            values.push(u);
            matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
            values.push(v);
        }

        const n = 8;
        const a = matrix.map((row, i) => [...row, values[i]]);

        for (let col = 0; col < n; col++) {
            let pivot = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
            }
            if (Math.abs(a[pivot][col]) < 1e-9) return null;

            [a[col], a[pivot]] = [a[pivot], a[col]];
            const divisor = a[col][col];
            for (let j = col; j <= n; j++) a[col][j] /= divisor;

            for (let row = 0; row < n; row++) {
                if (row === col) continue;
                const factor = a[row][col];
                for (let j = col; j <= n; j++) {
                    a[row][j] -= factor * a[col][j];
                }
            }
        }

        return a.map((row) => row[n]);
    }

    update() {
        if (!this.iframe || !this.camera?.camera) return;
        if (this.isPopupMode) return;
        this.enforceSettingsInteractionMode?.();

        const canvas = this.app.graphicsDevice?.canvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const worldTransform = this.entity.getWorldTransform();
        const cameraComponent = this.camera.camera;
        const viewMatrix = cameraComponent.viewMatrix;
        const points = [];

        for (let i = 0; i < 4; i++) {
            worldTransform.transformPoint(this.localCorners[i], this.worldCorners[i]);
            viewMatrix.transformPoint(this.worldCorners[i], this.viewPoint);

            if (this.viewPoint.z >= 0) {
                this.parkYouTubeIframe();
                return;
            }

            cameraComponent.worldToScreen(this.worldCorners[i], this.projected);
            if (!Number.isFinite(this.projected.x) || !Number.isFinite(this.projected.y)) {
                this.parkYouTubeIframe();
                return;
            }

            points.push({
                x: rect.left + this.projected.x,
                y: rect.top + this.projected.y
            });
        }

        const homography = this.solveHomography(points);
        if (!homography) {
            this.parkYouTubeIframe();
            return;
        }

        const cssMatrix = [
            homography[0], homography[3], 0, homography[6],
            homography[1], homography[4], 0, homography[7],
            0, 0, 1, 0,
            homography[2], homography[5], 0, 1
        ];

        Object.assign(this.iframe.style, {
            width: `${this.playerWidth}px`,
            height: `${this.playerHeight}px`,
            opacity: '1',
            visibility: 'visible',
            zIndex: '999999',
            transform: `matrix3d(${cssMatrix.join(',')})`
        });
    }

    parkYouTubeIframe() {
        if (!this.iframe || this.isPopupMode) return;
        Object.assign(this.iframe.style, {
            visibility: 'visible',
            opacity: '0.001',
            pointerEvents: 'none',
            transform: 'none',
            width: '200px',
            height: '200px',
            left: '0',
            top: '0',
            zIndex: '0',
            borderRadius: '0',
            boxShadow: 'none'
        });
    }

    enforceSettingsInteractionMode() {
        if (!this._settingsInteractionActive) return;

        const canvas = this.app.graphicsDevice?.canvas;
        if (canvas) {
            canvas.style.setProperty('pointer-events', 'none', 'important');
        }

        this.applyPointerCursorStyles?.();
        this.ensureSettingsCursorVisible?.();

        if (document.pointerLockElement) {
            this.releasePointerLock?.();
        }
    }

    layoutPopupIframe() {
        if (!this.iframe) return;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const aspect = this.playerWidth / this.playerHeight;
        const maxWidth = viewportWidth * 0.94;
        const maxHeight = viewportHeight * 0.76;

        let width = maxWidth;
        let height = width / aspect;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspect;
        }

        Object.assign(this.iframe.style, {
            position: 'fixed',
            left: `${(viewportWidth - width) * 0.5}px`,
            top: `${(viewportHeight - height) * 0.5}px`,
            width: `${width}px`,
            height: `${height}px`,
            transform: 'none',
            opacity: '1',
            visibility: 'visible',
            pointerEvents: 'auto',
            zIndex: '999999',
            borderRadius: '10px',
            boxShadow: '0 15px 50px rgba(0,0,0,0.5)'
        });
    }

    enterPopupMode() {
        if (this.isPopupMode) return;
        this.createYouTubeIframe();
        if (!this.iframe) return;

        this.isPopupMode = true;
        this._wasPointerLocked = false;
        this.setSettingsInteractionMode?.(true);

        if (this.settingsButton) this.settingsButton.style.display = 'none';
        if (this.settingsPanel) this.settingsPanel.style.display = 'none';
        if (this.closeButton) this.closeButton.style.display = 'inline-flex';
        if (this.popupBackdrop) this.popupBackdrop.style.display = 'block';
        if (this.mobileControlsScreen) this.mobileControlsScreen.enabled = false;

        this.layoutPopupIframe();
        this.app.fire('youtube:interaction-mode', true);
    }

    exitPopupMode() {
        if (!this.iframe || !this.isPopupMode) return;

        this.isPopupMode = false;
        if (this.closeButton) this.closeButton.style.display = 'none';
        if (this.popupBackdrop) this.popupBackdrop.style.display = 'none';
        if (this.settingsButton) {
            this.settingsButton.style.display = 'inline-flex';
            this.settingsButton.style.pointerEvents = 'auto';
        }
        if (this.settingsPanel) this.settingsPanel.style.display = 'block';

        this.setSettingsInteractionMode?.(true);
        if (this.mobileControlsScreen) {
            this.mobileControlsScreen.enabled = this._mobileControlsOriginalEnabled;
        }

        Object.assign(this.iframe.style, {
            visibility: 'visible',
            opacity: '0.001',
            pointerEvents: 'none',
            transform: 'none',
            width: '200px',
            height: '200px',
            left: '0',
            top: '0',
            zIndex: '0',
            borderRadius: '0',
            boxShadow: 'none'
        });

        this.app.fire('youtube:interaction-mode', false);
    }

    destroy() {
        this._disposeYouTubeDiagnostics?.();
        this._disposeLocalization?.();
        this._disposeLanguageControl?.();
        this.clearCursorGuard?.();
        if (this._workBrowserActive) this.setWorkBrowserActive(false);
        this.workPanel?.destroy();
        this.workPanel = null;

        if (this._onFirstSceneFrame) {
            this.app.off('postrender', this._onFirstSceneFrame, this);
        }
        if (this._youtubeLoadTimer !== null) {
            window.clearTimeout(this._youtubeLoadTimer);
            this._youtubeLoadTimer = null;
        }
        if (this._selectedBedroomBlobUrl) {
            URL.revokeObjectURL(this._selectedBedroomBlobUrl);
            this._selectedBedroomBlobUrl = null;
        }

        if (this._onBedroomVideoSoundState) {
            this.app.off('bedroom-video:sound-state', this._onBedroomVideoSoundState, this);
        }
        if (this._onBedroomVideoUrlsState) {
            this.app.off('bedroom-video:urls-state', this._onBedroomVideoUrlsState, this);
        }

        if (this._onPointerLockChange) {
            document.removeEventListener('pointerlockchange', this._onPointerLockChange);
        }
        if (this._onKeyDown) {
            document.removeEventListener('keydown', this._onKeyDown, true);
        }
        if (this._onCanvasInputWhileSettingsOpen) {
            document.removeEventListener('pointerdown', this._onCanvasInputWhileSettingsOpen, true);
            document.removeEventListener('mousedown', this._onCanvasInputWhileSettingsOpen, true);
            document.removeEventListener('touchstart', this._onCanvasInputWhileSettingsOpen, true);
        }

        if (this._onViewportResize) {
            window.removeEventListener('resize', this._onViewportResize);
            window.removeEventListener('orientationchange', this._onViewportResize);
            window.visualViewport?.removeEventListener('resize', this._onViewportResize);
            window.visualViewport?.removeEventListener('scroll', this._onViewportResize);
        }

        if (this.iframe) {
            this.iframe.remove();
            this.iframe = null;
        }
        if (this.overlayRoot) {
            this.overlayRoot.remove();
            this.overlayRoot = null;
        }
        if (this.popupBackdrop) {
            this.popupBackdrop.remove();
            this.popupBackdrop = null;
        }
    }
}
