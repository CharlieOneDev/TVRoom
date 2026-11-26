// @ts-nocheck
import { Script, Entity, Vec3, KEY_W, KEY_A, KEY_S, KEY_D } from 'playcanvas';
import { NotebookReaderUI } from './notebook-reader-ui.mjs';

export class InteractionManager extends Script {
    static scriptName = 'interactionManager';

    /**
     * @attribute
     * @title Camera
     * @type {Entity}
     */
    camera = null;

    /**
     * @attribute
     * @title Player Entity
     * @type {Entity}
     */
    playerEntity = null;

    /**
     * @attribute
     * @title Mobile Controls Screen
     * @type {Entity}
     */
    mobileControlsScreen = null;

    /**
     * @attribute
     * @title Interactable Tag
     * @type {string}
     */
    interactableTag = 'interactable';

    /**
     * @attribute
     * @title Default Distance
     * @type {number}
     * @min 0.25
     */
    defaultDistance = 2;

    initialize() {
        this.playerEntity = this.playerEntity ?? this.entity;
        this.interactables = new Set();
        this.selected = null;
        this.modalActive = false;
        this.externalOverlayActive = false;
        this._scanTimer = 0;
        this._point = new Vec3();
        this._origin = new Vec3();
        this._direction = new Vec3();
        this._farPoint = new Vec3();
        this._screenPoint = new Vec3();
        this._toTarget = new Vec3();
        this._visibilityPoint = new Vec3();
        this._movementAnchor = this.playerEntity.getPosition().clone();
        this._promptIdleSeconds = 0;
        this._wasInInteractionRange = false;

        this.createPrompt();
        this.notebookUI = new NotebookReaderUI(() => this.closeActiveInteraction());

        this._register = (interactable) => this.interactables.add(interactable);
        this._unregister = (interactable) => {
            this.interactables.delete(interactable);
            if (this.selected === interactable) this.setSelected(null);
        };
        this._onWorkBrowserActive = (active) => {
            this.externalOverlayActive = !!active;
            if (active) this.setSelected(null);
        };
        this.app.on('interaction:register', this._register, this);
        this.app.on('interaction:unregister', this._unregister, this);
        this.app.on('work-browser:active', this._onWorkBrowserActive, this);

        this._onDocumentKeyDown = (event) => this.onDocumentKeyDown(event);
        document.addEventListener('keydown', this._onDocumentKeyDown, true);
        this.setupTouchPicking();
        this.scanTaggedEntities();
        this.on('destroy', this.destroy, this);
    }

    createPrompt() {
        if (typeof document === 'undefined') return;
        this.promptElement = document.createElement('div');
        this.promptElement.setAttribute('data-scene-interaction-prompt', '');
        Object.assign(this.promptElement.style, {
            position: 'fixed', left: '50%', bottom: '14%', transform: 'translateX(-50%) translateY(8px)',
            zIndex: '880', display: 'block', padding: '8px', color: '#f1e6cf',
            textShadow: '0 0 6px rgba(255,232,184,.65), 0 0 16px rgba(255,218,148,.3)',
            font: '500 26px/1.2 Georgia,serif',
            letterSpacing: '.02em', pointerEvents: 'none', userSelect: 'none', opacity: '0',
            transition: 'opacity 1s ease, transform .3s ease'
        });
        this.promptElement.textContent = 'E';
        this.promptElement.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.promptElement);
        this.supportsTouch = !!this.app.touch || navigator.maxTouchPoints > 0;
        const coarsePointer = !!window.matchMedia?.('(pointer: coarse)').matches;
        const finePointer = !!window.matchMedia?.('(any-pointer: fine)').matches;
        this.isTouchDevice = coarsePointer && !finePointer;
    }

    setupTouchPicking() {
        const canvas = this.app.graphicsDevice?.canvas;
        if (!canvas || !this.supportsTouch) return;
        this.canvas = canvas;
        this._onPointerDown = (event) => {
            if (this.modalActive || this.externalOverlayActive || event.target !== canvas ||
                (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
            this.touchCandidate = {
                id: event.pointerId, x: event.clientX, y: event.clientY,
                time: performance.now(), moved: false
            };
        };
        this._onPointerMove = (event) => {
            const touch = this.touchCandidate;
            if (!touch || touch.id !== event.pointerId) return;
            if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 12) touch.moved = true;
        };
        this._onPointerUp = (event) => {
            const touch = this.touchCandidate;
            if (!touch || touch.id !== event.pointerId) return;
            this.touchCandidate = null;
            if (touch.moved || performance.now() - touch.time > 450 || this.modalActive) return;
            const target = this.pickAtClientPosition(event.clientX, event.clientY);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            this.openInteraction(target);
        };
        this._onPointerCancel = (event) => {
            if (this.touchCandidate?.id === event.pointerId) this.touchCandidate = null;
        };
        canvas.addEventListener('pointerdown', this._onPointerDown, true);
        window.addEventListener('pointermove', this._onPointerMove, true);
        window.addEventListener('pointerup', this._onPointerUp, true);
        window.addEventListener('pointercancel', this._onPointerCancel, true);
    }

    scanTaggedEntities() {
        for (const entity of this.app.root.findByTag(this.interactableTag) ?? []) {
            const instance = entity.script?.get('interactable');
            if (instance) this.interactables.add(instance);
        }
    }

    update(dt) {
        this._scanTimer -= dt;
        if (this._scanTimer <= 0) {
            this._scanTimer = 1;
            this.scanTaggedEntities();
        }
        this.updatePromptIdle(dt);
        if (this.modalActive || this.externalOverlayActive || !this.camera) {
            if (this.selected) this.setSelected(null);
            this.showPrompt(false);
            return;
        }
        const player = this.playerEntity.script?.get('roomPlayerController');
        this.setSelected(player?.isLying ? null : this.pickAtScreenCenter());
        this.showPrompt(!this.isTouchDevice && this._promptIdleSeconds < 5 &&
            !!(this.selected || this.isBedInRange() || (player?.enabled && player.isLying)));
    }

    isBedInRange() {
        const player = this.playerEntity.script?.get('roomPlayerController');
        if (!player?.enabled || player.isLying || !player.bedLiePoint || !player.bedExitPoint) return false;
        const position = this.playerEntity.getPosition();
        const bedside = player.bedExitPoint.getPosition();
        return Math.hypot(position.x - bedside.x, position.z - bedside.z) <= player.bedUseDistance;
    }

    updatePromptIdle(dt) {
        const player = this.playerEntity.script?.get('roomPlayerController');
        const lyingMovement = player?.enabled && player.isLying &&
            !this.modalActive && !this.externalOverlayActive && !this.isEditingText() &&
            this.hasMovementInput(player);
        const position = this.playerEntity.getPosition();
        const moved = Math.hypot(position.x - this._movementAnchor.x,
            position.z - this._movementAnchor.z) >= 0.01;
        // Range entry is independent of camera direction: looking away and back
        // must not restart the five-second timeout.
        const inRange = this.isBedInRange() || [...this.interactables].some(item => this.isAvailable(item));
        if (moved || lyingMovement || (inRange && !this._wasInInteractionRange)) {
            this._promptIdleSeconds = 0;
            this._movementAnchor.copy(position);
        } else {
            this._promptIdleSeconds += dt;
        }
        this._wasInInteractionRange = inRange;
    }

    hasMovementInput(player) {
        // Physics is disabled in bed, so movement intent must be read from
        // controls instead of position. Mouse/look input intentionally does not count.
        if ([KEY_W, KEY_A, KEY_S, KEY_D].some(key => this.app.keyboard?.isPressed(key))) return true;
        const joystick = player.moveJoystickEntity?.script?.get('touchJoystick');
        return !!joystick?.enabled && Math.hypot(joystick.axisX ?? 0, joystick.axisY ?? 0) > 0.1;
    }

    showPrompt(visible) {
        if (!this.promptElement) return;
        this.promptElement.style.opacity = visible ? '1' : '0';
        this.promptElement.style.transform = visible
            ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(4px)';
    }

    pickAtScreenCenter() {
        const device = this.app.graphicsDevice;
        const cameraPosition = this.camera.getPosition();
        const centerX = device.width * 0.5;
        const centerY = device.height * 0.5;
        const screenScale = Math.max(1, Math.min(device.width, device.height));
        let best = null;
        let bestScore = Infinity;

        for (const interactable of this.interactables) {
            if (!this.isAvailable(interactable)) continue;
            const point = interactable.getInteractionPoint(this._point);
            this._toTarget.sub2(point, cameraPosition).normalize();
            const facing = this._toTarget.dot(this.camera.forward);
            if (facing <= 0.05) continue;
            this.camera.camera.worldToScreen(point, this._screenPoint);
            const screenDistance = Math.hypot(this._screenPoint.x - centerX, this._screenPoint.y - centerY);
            if (!this.hasLineOfSight(interactable, this.getVisibilityPoint(interactable))) continue;
            // Prefer the object nearest the view center, but do not require the
            // player to aim precisely at a small prop before the prompt appears.
            const score = screenDistance / screenScale + (1 - facing) * 0.4 +
                cameraPosition.distance(point) * 0.04;
            if (score < bestScore) {
                best = interactable;
                bestScore = score;
            }
        }
        return best;
    }

    pickAtClientPosition(clientX, clientY) {
        const canvas = this.app.graphicsDevice?.canvas;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) * this.app.graphicsDevice.width / rect.width;
        const y = (clientY - rect.top) * this.app.graphicsDevice.height / rect.height;
        return this.pickAtScreenPosition(x, y);
    }

    pickAtScreenPosition(x, y) {
        const camera = this.camera?.camera;
        if (!camera) return null;
        camera.screenToWorld(x, y, camera.nearClip, this._origin);
        camera.screenToWorld(x, y, camera.farClip, this._farPoint);
        this._direction.sub2(this._farPoint, this._origin).normalize();

        let best = null;
        let bestRayDistance = Infinity;
        for (const interactable of this.interactables) {
            if (!this.isAvailable(interactable)) continue;
            const bounds = interactable.getRenderBounds();
            if (!bounds) continue;
            const rayDistance = this.intersectAabb(this._origin, this._direction, bounds.min, bounds.max);
            if (rayDistance === null || rayDistance >= bestRayDistance) continue;
            const targetPoint = this.getVisibilityPoint(interactable);
            if (!this.hasLineOfSight(interactable, targetPoint)) continue;
            best = interactable;
            bestRayDistance = rayDistance;
        }
        return best;
    }

    isAvailable(interactable) {
        if (!interactable?.interactionEnabled || !interactable.enabled || !interactable.entity?.enabled) return false;
        const distance = interactable.getConfig().distance ?? this.defaultDistance;
        const playerPosition = this.playerEntity?.getPosition();
        if (!playerPosition) return false;
        return playerPosition.distance(interactable.getInteractionPoint(this._point)) <= distance;
    }

    getVisibilityPoint(interactable) {
        const bounds = interactable.getRenderBounds();
        if (!bounds) return interactable.getInteractionPoint(this._visibilityPoint);
        this._visibilityPoint.copy(bounds.center);
        // Aim slightly above the upper surface so a desk supporting a thin
        // notebook is not mistaken for a wall between the player and target.
        this._visibilityPoint.y = bounds.max.y + 0.025;
        return this._visibilityPoint;
    }

    intersectAabb(origin, direction, min, max) {
        let near = 0;
        let far = Infinity;
        for (const axis of ['x', 'y', 'z']) {
            if (Math.abs(direction[axis]) < 1e-7) {
                if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
                continue;
            }
            let a = (min[axis] - origin[axis]) / direction[axis];
            let b = (max[axis] - origin[axis]) / direction[axis];
            if (a > b) [a, b] = [b, a];
            near = Math.max(near, a);
            far = Math.min(far, b);
            if (near > far) return null;
        }
        return near;
    }

    hasLineOfSight(interactable, point) {
        const rigidbody = this.app.systems.rigidbody;
        if (!rigidbody?.raycastAll) return true;
        const hits = rigidbody.raycastAll(this.camera.getPosition(), point) ?? [];
        hits.sort((a, b) => a.point.distance(this.camera.getPosition()) - b.point.distance(this.camera.getPosition()));
        const cameraPosition = this.camera.getPosition();
        const fullDistance = cameraPosition.distance(point);
        for (const hit of hits) {
            const entity = hit.entity;
            if (!entity || this.isRelatedEntity(entity, this.playerEntity)) continue;
            // A supporting desk or shelf can touch the notebook's bounds at the
            // end of the ray without actually hiding it.
            if (fullDistance - hit.point.distance(cameraPosition) <= 0.12) continue;
            return this.isRelatedEntity(entity, interactable.entity);
        }
        return true;
    }

    isRelatedEntity(entity, root) {
        if (!entity || !root) return false;
        let current = entity;
        while (current) {
            if (current === root) return true;
            current = current.parent;
        }
        current = root;
        while (current) {
            if (current === entity) return true;
            current = current.parent;
        }
        return false;
    }

    setSelected(interactable) {
        this.selected = interactable;
        const player = this.playerEntity.script?.get('roomPlayerController');
        const touchTarget = interactable?.getConfig().type === 'notebook' ? interactable : null;
        player?.setTouchInteractionTarget?.(touchTarget, this);
        if (this.modalActive || this.externalOverlayActive) this.showPrompt(false);
    }

    onDocumentKeyDown(event) {
        if (this.modalActive && event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.closeActiveInteraction();
            return;
        }
        if (this.modalActive || this.externalOverlayActive || event.repeat ||
            event.key.toLowerCase() !== 'e' || !this.selected || this.isEditingText()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.openInteraction(this.selected);
    }

    isEditingText() {
        const active = document.activeElement;
        return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
            active instanceof HTMLSelectElement || active?.isContentEditable;
    }

    openInteraction(interactable) {
        if (!this.isAvailable(interactable) || this.modalActive) return;
        const config = interactable.getConfig();
        if (config.type === 'notebook') {
            this.setModalActive(true);
            this.notebookUI.open(config);
            this.app.fire('interaction:opened', config, interactable.entity);
            return;
        }
        if (['image', 'website', 'video', 'dialogue', 'event'].includes(config.type)) {
            this.app.fire(`interaction:${config.type}`, config, interactable.entity);
        } else {
            console.warn(`[InteractionManager] Unsupported interaction type: ${config.type}`);
        }
    }

    closeActiveInteraction() {
        if (!this.modalActive) return;
        this.notebookUI.close();
        this.setModalActive(false);
        this.app.fire('interaction:closed');
    }

    setModalActive(active) {
        active = !!active;
        if (this.modalActive === active) return;
        this.modalActive = active;
        this.setSelected(null);
        if (active) {
            this._wasPointerLocked = !!document.pointerLockElement;
            this._mobileControlsWereEnabled = this.mobileControlsScreen?.enabled;
            if (this.mobileControlsScreen) this.mobileControlsScreen.enabled = false;
            this.app.mouse?.disablePointerLock?.();
            if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
        } else if (this.mobileControlsScreen && this._mobileControlsWereEnabled !== undefined) {
            this.mobileControlsScreen.enabled = this._mobileControlsWereEnabled;
        }
        this.app.fire('scene-interaction:active', active);
        if (!active && this._wasPointerLocked && !this.isTouchDevice) {
            this._wasPointerLocked = false;
            try {
                this.app.mouse?.enablePointerLock?.();
            } catch (error) {
                // Some browsers require the next canvas click before pointer
                // lock can be restored. Normal player input still remains active.
                console.debug('[InteractionManager] Pointer lock restore deferred.', error);
            }
        }
    }

    destroy() {
        this.playerEntity.script?.get('roomPlayerController')?.setTouchInteractionTarget?.(null, null);
        this._wasPointerLocked = false;
        if (this.modalActive) this.setModalActive(false);
        this.app.off('interaction:register', this._register, this);
        this.app.off('interaction:unregister', this._unregister, this);
        this.app.off('work-browser:active', this._onWorkBrowserActive, this);
        document.removeEventListener('keydown', this._onDocumentKeyDown, true);
        if (this.canvas) this.canvas.removeEventListener('pointerdown', this._onPointerDown, true);
        window.removeEventListener('pointermove', this._onPointerMove, true);
        window.removeEventListener('pointerup', this._onPointerUp, true);
        window.removeEventListener('pointercancel', this._onPointerCancel, true);
        this.promptElement?.remove();
        this.notebookUI?.destroy();
    }
}
