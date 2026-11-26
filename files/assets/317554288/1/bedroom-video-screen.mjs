// @ts-nocheck
import {
    Script,
    Asset,
    Texture,
    StandardMaterial,
    PIXELFORMAT_R8_G8_B8,
    FILTER_LINEAR,
    ADDRESS_CLAMP_TO_EDGE
} from 'playcanvas';
import { getSceneAudio } from '../scene-audio.mjs';
import { VideoTextureSource } from '../video-texture-source.mjs';

export class BedroomVideoScreen extends Script {
    static scriptName = 'bedroomVideoScreen';

    /**
     * @attribute
     * @title Video Asset
     * @type {Asset}
     */
    videoAsset = null;

    /**
     * @attribute
     * @title Video URLs (comma separated)
     * @type {string}
     */
    videoUrls = '';

    /**
     * @attribute
     * @title Mobile Video Max Size
     * @type {number}
     * @min 256
     */
    mobileVideoMaxSize = 1920;

    initialize() {
        this.sceneAudio = getSceneAudio(this.app);
        if (!this.entity.render || !this.entity.render.meshInstances.length) {
            console.error('[BedroomVideo] Entity needs a Render component.');
            this.app.fire('bedroom-video:sound-state', true, false);
            return;
        }

        if (!this.videoAsset || typeof this.videoAsset.getFileUrl !== 'function') {
            const urlOnly = this.parseVideoUrls();
            if (urlOnly.length === 0) {
                console.error('[BedroomVideo] Video Asset is missing or invalid.');
                this.app.fire('bedroom-video:sound-state', true, false);
                return;
            }
        }

        const videoUrls = this.parseVideoUrls();
        const fallbackUrl = this.getFallbackVideoUrl();
        const videoUrl = videoUrls[0] || fallbackUrl;
        if (!videoUrl) {
            console.error('[BedroomVideo] Video URL is invalid.');
            this.app.fire('bedroom-video:sound-state', true, false);
            return;
        }

        this._textureUploadBlocked = false;
        this._originalMaterials = [];
        this._meshInstances = this.entity.render.meshInstances.slice();

        const video = document.createElement('video');
        this.video = video;
        this._disposeAudioDiagnostics = this.sceneAudio.watchMedia(video, 'bedroom-video');

        // Must be set before src. The asset host must also return an
        // Access-Control-Allow-Origin header for this application origin.
        video.crossOrigin = 'anonymous';

        const isMobile = !!this.app.touch ||
            (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
        this._textureUploadInterval = isMobile ? 1 / 15 : 0;
        this._textureUploadElapsed = 0;

        // Load and autoplay muted immediately after scene initialization.
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0.8;
        this._bedroomVideoVolume = 0.8;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;

        Object.assign(video.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '2px',
            height: '2px',
            opacity: '0.001',
            pointerEvents: 'none',
            zIndex: '0'
        });
        document.body.appendChild(video);

        // The Settings UI communicates with this script through app events.
        this._onSetMuted = (muted) => this.setMuted(muted);
        this._onSetVolume = (volume) => this.setVolume(volume);
        this._onRequestSoundState = () => this.emitSoundState();
        this._onSetAsset = (assetOrUrl) => this.setVideoAsset(assetOrUrl);
        this._onClearLocalFile = () => this.clearLocalFile();
        this._onSetUrls = (urls) => {
            this.videoUrls = String(urls || '');
            this._playbackUrls = this.parseVideoUrls();
            this._playbackUrlIndex = 0;

            if (this._playbackUrls.length > 0) {
                this.setVideoAsset(this._playbackUrls[0]);
                this._playbackUrlIndex = 1 % this._playbackUrls.length;
            } else {
                const fallbackUrl = this.getFallbackVideoUrl();
                if (fallbackUrl) this.setVideoAsset(fallbackUrl);
            }

            this.app.fire('bedroom-video:urls-state', this.videoUrls);
        };
        this._onRequestUrlsState = () => {
            this.app.fire('bedroom-video:urls-state', this.videoUrls || '');
        };
        this.app.on('bedroom-video:set-muted', this._onSetMuted, this);
        this.app.on('bedroom-video:set-volume', this._onSetVolume, this);
        this.app.on('bedroom-video:request-sound-state', this._onRequestSoundState, this);
        this.app.on('bedroom-video:set-asset', this._onSetAsset, this);
        this.app.on('bedroom-video:clear-local-file', this._onClearLocalFile, this);
        this.app.on('bedroom-video:set-urls', this._onSetUrls, this);
        this.app.on('bedroom-video:request-urls-state', this._onRequestUrlsState, this);
        this._onVisibilityChange = () => {
            if (document.hidden) {
                this._resumeAfterVisibility = !video.paused;
                return;
            }
            if (!this._resumeAfterVisibility) return;
            this._resumeAfterVisibility = false;
            // Only restore silent visuals automatically. Audible media needs a
            // fresh explicit user action, otherwise it may steal YouTube focus.
            if (!video.paused || !video.muted) {
                this.sceneAudio.log('media:visibility-no-restart', { label: 'bedroom-video', paused: video.paused, muted: video.muted });
                return;
            }
            this.sceneAudio.log('media:resume-request', { label: 'bedroom-video', source: 'visible-muted-video' });
            const resumeResult = video.play();
            if (resumeResult && typeof resumeResult.catch === 'function') {
                resumeResult.catch(error => console.warn('[BedroomVideo] Visibility resume failed:', error));
            }
        };
        this._onPageShow = () => this._onVisibilityChange();
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        window.addEventListener('pageshow', this._onPageShow);

        this.videoTexture = new Texture(this.app.graphicsDevice, {
            format: PIXELFORMAT_R8_G8_B8,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            mipmaps: false,
            anisotropy: Math.min(4, this.app.graphicsDevice.maxAnisotropy || 1)
        });

        this.videoMaterial = new StandardMaterial();
        this.videoMaterial.name = 'BedroomVideoMaterial';
        this.videoMaterial.useLighting = false;
        this.videoMaterial.diffuse.set(1, 1, 1);
        this.videoMaterial.diffuseMap = this.videoTexture;
        this.videoMaterial.update();
        this.videoTextureSource = new VideoTextureSource({
            video, texture: this.videoTexture, material: this.videoMaterial,
            map: 'diffuseMap', aspect: 4 / 3, mode: 'cover',
            maxSize: Math.min(this.app.graphicsDevice.maxTextureSize,
                isMobile ? Math.max(256, Number(this.mobileVideoMaxSize) || 1920) : Infinity),
            label: 'BedroomVideo'
        });

        for (const instance of this._meshInstances) {
            this._originalMaterials.push(instance.material);
            instance.material = this.videoMaterial;
        }

        this._onVideoReady = () => {
            // Autoplay is muted, which is allowed by most modern browsers.
            if (!video.paused) return;
            this.sceneAudio.log('media:play-request', { label: 'bedroom-video', source: 'initial loadeddata' });
            const playResult = video.play();
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch(error => {
                    console.warn('[BedroomVideo] Autoplay was blocked:', error);
                });
            }
        };

        this._onVideoEnded = () => this.playNextVideo();
        this._onVideoError = () => {
            console.error('[BedroomVideo] Failed to load video:', video.error);
            this.playNextVideo();
        };

        video.addEventListener('loadeddata', this._onVideoReady, { once: true });
        video.addEventListener('ended', this._onVideoEnded);
        video.addEventListener('error', this._onVideoError);

        // Let the loading screen clear before this media request starts.
        // This prevents the decoder and scene assets from contending at boot.
        this._startVideoLoad = () => {
            this._startVideoLoad = null;
            video.src = videoUrl;
            video.load();
        };
        this.app.once('postrender', this._startVideoLoad, this);

        this._playbackUrls = videoUrls;
        this._playbackUrlIndex = videoUrls.length > 1 ? 1 : 0;

        this.emitSoundState();
    }

    parseVideoUrls() {
        return String(this.videoUrls || '')
            .split(',')
            .map((url) => url.trim())
            .filter((url) => /^https?:\/\//i.test(url));
    }

    getFallbackVideoUrl() {
        return this.videoAsset && typeof this.videoAsset.getFileUrl === 'function'
            ? this.videoAsset.getFileUrl()
            : '';
    }

    playNextVideo() {
        if (!this.video) return;

        if (!this._playbackUrls) {
            this._playbackUrls = this.parseVideoUrls();
        }

        if (this._playbackUrlIndex === undefined) {
            this._playbackUrlIndex = 0;
        }

        if (this._playbackUrls.length > 0) {
            const nextUrl = this._playbackUrls[
                this._playbackUrlIndex % this._playbackUrls.length
            ];
            this._playbackUrlIndex = (this._playbackUrlIndex + 1) % this._playbackUrls.length;

            if (nextUrl !== this.video.src) {
                this.setVideoAsset(nextUrl);
            }
            return;
        }

        const fallbackUrl = this.getFallbackVideoUrl();
        if (fallbackUrl && fallbackUrl !== this.video.src) {
            this.setVideoAsset(fallbackUrl);
        }
    }

    setVideoAsset(assetOrUrl) {
        const nextUrl = typeof assetOrUrl === 'string'
            ? assetOrUrl
            : assetOrUrl?.getFileUrl?.();

        if (!nextUrl || !this.video) {
            console.error('[BedroomVideo] Invalid video asset or URL.');
            return;
        }

        if (new URL(nextUrl, document.baseURI).href === this.video.src) return;
        this.sceneAudio.log('media:source-change', { label: 'bedroom-video', source: 'asset/playlist selection' });

        if (typeof nextUrl === 'string' && nextUrl.startsWith('blob:')) {
            if (this._selectedBlobUrl && this._selectedBlobUrl !== nextUrl) {
                URL.revokeObjectURL(this._selectedBlobUrl);
            }
            this._selectedBlobUrl = nextUrl;
        } else if (this._selectedBlobUrl) {
            URL.revokeObjectURL(this._selectedBlobUrl);
            this._selectedBlobUrl = null;
        }

        this.video.pause();
        this.video.removeAttribute('src');
        this.video.src = nextUrl;
        this.video.load();

        const playResult = this.video.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(error => {
                console.warn('[BedroomVideo] Could not play selected video:', error);
            });
        }

        this.emitSoundState();
        this.app.fire('bedroom-video:asset-changed', nextUrl);
    }

    clearLocalFile() {
        if (this._selectedBlobUrl) {
            URL.revokeObjectURL(this._selectedBlobUrl);
            this._selectedBlobUrl = null;
        }
        const fallbackUrl = this.getFallbackVideoUrl();
        if (fallbackUrl) this.setVideoAsset(fallbackUrl);
    }

    setMuted(muted) {
        if (!this.video) return;

        const nextMuted = !!muted;
        this.video.defaultMuted = nextMuted;
        if (nextMuted) {
            this.video.setAttribute('muted', '');
        } else {
            this.video.removeAttribute('muted');
        }
        this.video.muted = nextMuted;

        // Called synchronously from the Settings button's click/tap event,
        // preserving the browser's user-activation permission to unmute.
        if (!this.video.muted && this.video.paused) {
            this.sceneAudio.log('media:resume-request', { label: 'bedroom-video', source: 'user unmute' });
            const playResult = this.video.play();
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch(error => {
                    console.warn('[BedroomVideo] Could not resume playback:', error);
                });
            }
        }

        this.emitSoundState();
    }

    setVolume(volume) {
        if (!this.video) return;

        const parsedVolume = Number(volume);
        const nextVolume = Number.isFinite(parsedVolume)
            ? Math.min(1, Math.max(0, parsedVolume))
            : this._bedroomVideoVolume;

        this._bedroomVideoVolume = nextVolume;
        this.video.volume = nextVolume;

        if (nextVolume === 0) {
            this.video.defaultMuted = true;
            this.video.setAttribute('muted', '');
            this.video.muted = true;
        } else if (this.video.muted) {
            this.video.defaultMuted = false;
            this.video.removeAttribute('muted');
            this.video.muted = false;
            this.sceneAudio.log('media:unmute-request', { label: 'bedroom-video', source: 'user volume change' });
            const playResult = this.video.paused ? this.video.play() : null;
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch(error => {
                    console.warn('[BedroomVideo] Could not resume playback:', error);
                });
            }
        }

        this.emitSoundState();
    }

    emitSoundState() {
        const volume = this.video
            ? this.video.volume
            : (this._bedroomVideoVolume ?? 0.8);

        this.app.fire(
            'bedroom-video:sound-state',
            this.video ? this.video.muted : true,
            !!this.video,
            volume
        );
    }

    update(dt) {
        if (this._textureUploadInterval > 0) {
            this._textureUploadElapsed += dt;
            if (this._textureUploadElapsed < this._textureUploadInterval) return;
            this._textureUploadElapsed %= this._textureUploadInterval;
        }
        this.videoTextureSource?.update();
    }

    destroy() {
        this.videoTextureSource?.destroy();
        if (this._startVideoLoad) {
            this.app.off('postrender', this._startVideoLoad, this);
            this._startVideoLoad = null;
        }
        this._disposeAudioDiagnostics?.();
        if (this._onSetMuted) this.app.off('bedroom-video:set-muted', this._onSetMuted, this);
        if (this._onSetVolume) this.app.off('bedroom-video:set-volume', this._onSetVolume, this);
        if (this._onRequestSoundState) this.app.off('bedroom-video:request-sound-state', this._onRequestSoundState, this);
        if (this._onSetAsset) this.app.off('bedroom-video:set-asset', this._onSetAsset, this);
        if (this._onClearLocalFile) this.app.off('bedroom-video:clear-local-file', this._onClearLocalFile, this);
        if (this._onSetUrls) this.app.off('bedroom-video:set-urls', this._onSetUrls, this);
        if (this._onRequestUrlsState) this.app.off('bedroom-video:request-urls-state', this._onRequestUrlsState, this);
        if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
        if (this._onPageShow) window.removeEventListener('pageshow', this._onPageShow);

        if (this._selectedBlobUrl) {
            URL.revokeObjectURL(this._selectedBlobUrl);
            this._selectedBlobUrl = null;
        }

        if (this._meshInstances && this._originalMaterials) {
            this._meshInstances.forEach((instance, index) => {
                instance.material = this._originalMaterials[index] || null;
            });
        }

        if (this.video) {
            this.video.pause();
            this.video.removeEventListener('loadeddata', this._onVideoReady);
            this.video.removeEventListener('ended', this._onVideoEnded);
            this.video.removeEventListener('error', this._onVideoError);
            this.video.removeAttribute('src');
            this.video.load();
            this.video.remove();
            this.video = null;
        }

        if (this.videoMaterial) {
            this.videoMaterial.destroy();
            this.videoMaterial = null;
        }

        if (this.videoTexture) {
            this.videoTexture.destroy();
            this.videoTexture = null;
        }
    }
}
