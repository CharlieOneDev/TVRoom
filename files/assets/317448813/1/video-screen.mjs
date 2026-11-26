// @ts-nocheck
import {
    Script,
    Asset,
    Texture,
    StandardMaterial,
    Color,
    PIXELFORMAT_R8_G8_B8,
    FILTER_LINEAR,
    ADDRESS_CLAMP_TO_EDGE,
    CULLFACE_NONE
} from 'playcanvas';
import { getSceneAudio } from './scene-audio.mjs';
import { VideoTextureSource } from './video-texture-source.mjs';

export class VideoScreen extends Script {
    static scriptName = 'videoScreen';

    /**
     * @attribute
     * @title Video File
     * @type {Asset}
     */
    videoAsset = null;

    /**
     * @attribute
     * @title Mobile Video Max Size
     * @type {number}
     * @min 256
     */
    mobileVideoMaxSize = 1920;

    initialize() {
        this.sceneAudio = getSceneAudio(this.app);
        console.log('[VideoScreen] Initializing');

        if (!this.entity.render || !this.videoAsset) {
            console.error('[VideoScreen] Missing Render or Video Asset');
            return;
        }

        const video = document.createElement('video');
        this.video = video;
        this._disposeAudioDiagnostics = this.sceneAudio.watchMedia(video, 'video-screen');

        video.loop = true;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        Object.assign(video.style, {
            width: '1px',
            height: '1px',
            position: 'absolute',
            opacity: '0',
            zIndex: '-1000',
            pointerEvents: 'none'
        });

        document.body.appendChild(video);

        // Throttle uploads on mobile without reducing normal 1080p detail.
        const isMobile = !!this.app.touch ||
            (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
        this._textureUploadInterval = isMobile ? 1 / 15 : 0;
        this._textureUploadElapsed = 0;

        // Create video texture
        const texture = new Texture(this.app.graphicsDevice, {
            format: PIXELFORMAT_R8_G8_B8,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            mipmaps: false,
            anisotropy: Math.min(4, this.app.graphicsDevice.maxAnisotropy || 1)
        });

        this.videoTexture = texture;

        // Create video screen material
        const material = new StandardMaterial();
        this.material = material;

        material.diffuse = new Color(0, 0, 0);
        material.emissive = new Color(1, 1, 1);
        material.emissiveMap = texture;

        // Render both front and back faces
        material.cull = CULLFACE_NONE;

        material.update();
        this.videoTextureSource = new VideoTextureSource({
            video, texture, material, map: 'emissiveMap', aspect: 16 / 9, mode: 'contain',
            maxSize: Math.min(this.app.graphicsDevice.maxTextureSize,
                isMobile ? Math.max(256, Number(this.mobileVideoMaxSize) || 1920) : Infinity),
            label: 'VideoScreen'
        });

        // Apply material to the Plane
        this.entity.render.material = material;

        console.log(
            '[VideoScreen] Material applied to',
            this.entity.name
        );

        // Video metadata
        video.addEventListener('loadedmetadata', () => {
            console.log(
                '[VideoScreen] Video dimensions:',
                video.videoWidth,
                'x',
                video.videoHeight
            );

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                console.error(
                    '[VideoScreen] No decoded video frames. Check video codec.'
                );
            }
        });

        // Start playback
        video.addEventListener('canplay', () => {
            console.log('[VideoScreen] Video can play');
            if (!video.paused) return;
            this.sceneAudio.log('media:play-request', { label: 'video-screen', source: 'initial canplay' });
            video.play().then(() => {
                console.log('[VideoScreen] Playback started');
            }).catch(error => {
                console.error('[VideoScreen] Playback failed:', error);
            });
        }, { once: true });

        video.addEventListener('error', () => {
            console.error('[VideoScreen] Video error:', video.error);
        });

        // Let PlayCanvas present one frame before a media request competes
        // with scene startup on a constrained mobile connection.
        this._startVideoLoad = () => {
            this._startVideoLoad = null;
            video.src = this.videoAsset.getFileUrl();
            video.load();
        };
        this.app.once('postrender', this._startVideoLoad, this);

        // Preserve the existing first-gesture sound activation, but do not
        // restart an already playing video when enabling its sound.
        this.enableSound = () => {
            this.sceneAudio.log('media:unmute-request', { label: 'video-screen', source: 'first-user-gesture' });
            video.muted = false;

            if (video.paused) video.play().catch(error => {
                console.warn('[VideoScreen] Audio error:', error);
            });
        };

        document.addEventListener('pointerdown', this.enableSound, { once: true });

        this._onWorkBrowserActive = (active) => {
            this.sceneAudio.log('media:work-ui', { label: 'video-screen', active, action: 'keep-playing' });
        };
        this.app.on('work-browser:active', this._onWorkBrowserActive, this);

        this.on('destroy', () => {
            this.videoTextureSource?.destroy();
            this._disposeAudioDiagnostics?.();
            if (this._startVideoLoad) {
                this.app.off('postrender', this._startVideoLoad, this);
                this._startVideoLoad = null;
            }
            document.removeEventListener('pointerdown', this.enableSound);
            this.app.off('work-browser:active', this._onWorkBrowserActive, this);

            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();

            texture.destroy();
            material.destroy();
        });
    }


    update(dt) {
        if (this._textureUploadInterval > 0) {
            this._textureUploadElapsed += dt;
            if (this._textureUploadElapsed < this._textureUploadInterval) return;
            this._textureUploadElapsed %= this._textureUploadInterval;
        }
        this.videoTextureSource?.update();
    }
}
