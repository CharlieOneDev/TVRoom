// @ts-nocheck
import { Script, Vec3 } from 'playcanvas';
import { getInteractionContent } from './interaction-content.mjs';

export class Interactable extends Script {
    static scriptName = 'interactable';

    /**
     * @attribute
     * @title Interaction ID
     * @type {string}
     */
    interactionId = 'investigation_notebook';

    /**
     * @attribute
     * @title Interaction Type
     * @type {string}
     */
    interactionType = 'notebook';

    /**
     * @attribute
     * @title Prompt
     * @type {string}
     */
    prompt = 'Read Notebook';

    /**
     * @attribute
     * @title Interaction Distance
     * @type {number}
     * @min 0.25
     */
    interactionDistance = 2;

    /**
     * @attribute
     * @title Interaction Enabled
     * @type {boolean}
     */
    interactionEnabled = true;

    initialize() {
        this.app.fire('interaction:register', this);
        this.on('destroy', this.destroy, this);
    }

    getConfig() {
        const content = getInteractionContent(this.interactionId) ?? {};
        return {
            ...content,
            id: this.interactionId || content.id || this.entity.name,
            type: this.interactionType || content.type || 'event',
            prompt: this.prompt || content.prompt || 'Interact',
            distance: Number.isFinite(this.interactionDistance)
                ? this.interactionDistance
                : (content.distance ?? 2)
        };
    }

    getInteractionPoint(out = new Vec3()) {
        const bounds = this.getRenderBounds();
        return bounds ? out.copy(bounds.center) : out.copy(this.entity.getPosition());
    }

    getRenderBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        const visit = (entity) => {
            const meshInstances = entity.render?.meshInstances ?? entity.model?.meshInstances ?? [];
            for (const meshInstance of meshInstances) {
                const aabb = meshInstance.aabb;
                if (!aabb) continue;
                const c = aabb.center;
                const h = aabb.halfExtents;
                minX = Math.min(minX, c.x - h.x);
                minY = Math.min(minY, c.y - h.y);
                minZ = Math.min(minZ, c.z - h.z);
                maxX = Math.max(maxX, c.x + h.x);
                maxY = Math.max(maxY, c.y + h.y);
                maxZ = Math.max(maxZ, c.z + h.z);
            }
            for (const child of entity.children ?? []) visit(child);
        };
        visit(this.entity);

        if (!Number.isFinite(minX)) return null;
        return {
            min: new Vec3(minX, minY, minZ),
            max: new Vec3(maxX, maxY, maxZ),
            center: new Vec3(
                (minX + maxX) * 0.5,
                (minY + maxY) * 0.5,
                (minZ + maxZ) * 0.5
            )
        };
    }

    destroy() {
        this.app.fire('interaction:unregister', this);
    }
}
