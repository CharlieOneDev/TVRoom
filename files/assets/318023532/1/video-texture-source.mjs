// Native video upload whenever possible; canvas is only for letterboxing or
// an explicit device-size limit. No fixed low-resolution intermediate texture.
export function videoTextureLayout(width, height, aspect, mode, maxSize) {
    const ratio = width / height;
    const letterbox = mode === 'contain' && Math.abs(ratio - aspect) > 0.001;
    let outputWidth = width;
    let outputHeight = height;
    if (letterbox) {
        outputWidth = Math.max(width, height * aspect);
        outputHeight = outputWidth / aspect;
    }
    const scale = Math.min(1, maxSize / Math.max(outputWidth, outputHeight));
    outputWidth = Math.max(1, Math.floor(outputWidth * scale));
    outputHeight = Math.max(1, Math.floor(outputHeight * scale));
    return {
        width: outputWidth, height: outputHeight,
        direct: !letterbox && scale === 1,
        letterbox,
        tileX: mode === 'cover' ? Math.min(1, aspect / ratio) : 1,
        tileY: mode === 'cover' ? Math.min(1, ratio / aspect) : 1
    };
}

export class VideoTextureSource {
    constructor({ video, texture, material, map, aspect, mode, maxSize, label }) {
        Object.assign(this, { video, texture, material, map, aspect, mode, maxSize, label });
        this.lastTime = -1;
        this.sizeKey = '';
        this.blocked = false;
        this.onLoad = () => { this.lastTime = -1; this.sizeKey = ''; this.blocked = false; };
        video.addEventListener('loadstart', this.onLoad);
    }

    update() {
        const video = this.video;
        if (this.blocked || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const key = `${video.videoWidth}x${video.videoHeight}`;
        if (key === this.sizeKey && video.currentTime === this.lastTime) return;
        try {
            const resized = key !== this.sizeKey;
            if (resized) {
                this.layout = videoTextureLayout(video.videoWidth, video.videoHeight, this.aspect, this.mode, this.maxSize);
                const { tileX, tileY } = this.layout;
                this.material[`${this.map}Tiling`].set(tileX, tileY);
                this.material[`${this.map}Offset`].set((1 - tileX) / 2, (1 - tileY) / 2);
                this.material.update();
                if (!this.layout.direct) {
                    this.canvas ??= document.createElement('canvas');
                    this.canvas.width = this.layout.width;
                    this.canvas.height = this.layout.height;
                    this.context ??= this.canvas.getContext('2d', { alpha: false });
                    if (!this.context) throw new Error('Canvas 2D is unavailable');
                    this.context.imageSmoothingEnabled = true;
                    this.context.imageSmoothingQuality = 'high';
                }
                console.info(`[${this.label}] Video texture`, {
                    source: key, texture: `${this.layout.width}x${this.layout.height}`,
                    path: this.layout.direct ? 'HTMLVideoElement' : 'canvas (letterbox/device limit)',
                    uv: [tileX, tileY]
                });
            }
            if (!this.layout.direct) {
                const { width, height, letterbox } = this.layout;
                const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
                const drawWidth = letterbox ? video.videoWidth * scale : width;
                const drawHeight = letterbox ? video.videoHeight * scale : height;
                this.context.fillStyle = '#000';
                this.context.fillRect(0, 0, width, height);
                this.context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
            }
            if (resized) this.texture.setSource(this.layout.direct ? video : this.canvas);
            else this.texture.upload();
            this.sizeKey = key;
            this.lastTime = video.currentTime;
        } catch (error) {
            this.blocked = true;
            console.error(`[${this.label}] Video texture failed. Check video dimensions and host CORS headers.`, error);
        }
    }

    destroy() {
        this.video.removeEventListener('loadstart', this.onLoad);
        if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
        this.canvas = null;
        this.context = null;
    }
}
