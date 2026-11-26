import { Asset, Script } from 'playcanvas';

/**
 * Loads the cat only after the first frame of the scene has been rendered.
 *
 * Assign a Template asset created from the complete cat hierarchy (model,
 * animation, colliders and CatWander script), rather than assigning the GLB
 * directly. This preserves every component when the template is instantiated.
 */
export class DeferredCatLoader extends Script {
    static scriptName = 'deferredCatLoader';

    /**
     * @attribute
     * @title Cat Template Asset
     * @type {Asset}
     */
    catTemplateAsset = null;

    /**
     * @attribute
     * @title Delay After First Frame (ms)
     * @type {number}
     */
    loadDelayMs = 1500;

    initialize() {
        this.catInstance = null;
        this._loadTimer = null;
        this._destroyed = false;

        // Waiting for postrender guarantees that the scene is visible before
        // the cat's GLB and its dependencies begin competing for bandwidth.
        this._onFirstFrame = () => {
            const delay = Math.max(0, Number(this.loadDelayMs) || 0);
            this._loadTimer = setTimeout(() => this.loadCat(), delay);
        };
        this.app.once('postrender', this._onFirstFrame, this);
    }

    loadCat() {
        this._loadTimer = null;

        if (this._destroyed || this.catInstance) return;

        const asset = this.catTemplateAsset;
        if (!asset) {
            console.warn('[DeferredCatLoader] Assign a cat Template asset.');
            return;
        }

        const instantiate = () => {
            if (this._onCatAssetError) asset.off('error', this._onCatAssetError, this);
            this._loadingCatAsset = null;
            this._onCatAssetLoad = null;
            this._onCatAssetError = null;
            if (this._destroyed || this.catInstance) return;

            const template = asset.resource;
            if (!template || typeof template.instantiate !== 'function') {
                console.error('[DeferredCatLoader] Asset must be a loaded Template asset:', asset.name);
                return;
            }

            this.catInstance = template.instantiate();
            this.entity.addChild(this.catInstance);
            console.log('[DeferredCatLoader] Cat loaded:', asset.name);
        };

        if (asset.resource) {
            instantiate();
            return;
        }

        this._loadingCatAsset = asset;
        this._onCatAssetLoad = instantiate;
        this._onCatAssetError = (error) => {
            asset.off('load', this._onCatAssetLoad, this);
            this._loadingCatAsset = null;
            this._onCatAssetLoad = null;
            this._onCatAssetError = null;
            if (this._destroyed) return;
            console.error('[DeferredCatLoader] Failed to load cat:', asset.name, error);
        };
        asset.once('load', this._onCatAssetLoad, this);
        asset.once('error', this._onCatAssetError, this);
        this.app.assets.load(asset);
    }

    destroy() {
        this._destroyed = true;
        this.app.off('postrender', this._onFirstFrame, this);

        if (this._loadTimer !== null) {
            clearTimeout(this._loadTimer);
            this._loadTimer = null;
        }

        if (this._loadingCatAsset) {
            if (this._onCatAssetLoad) this._loadingCatAsset.off('load', this._onCatAssetLoad, this);
            if (this._onCatAssetError) this._loadingCatAsset.off('error', this._onCatAssetError, this);
            this._loadingCatAsset = null;
            this._onCatAssetLoad = null;
            this._onCatAssetError = null;
        }

        if (this.catInstance) {
            this.catInstance.destroy();
            this.catInstance = null;
        }
    }
}
