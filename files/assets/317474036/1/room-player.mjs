// @ts-nocheck
import {
    Script,
    Entity,
    Vec3,
    Mouse,
    KEY_W,
    KEY_A,
    KEY_S,
    KEY_D,
    KEY_SHIFT,
    KEY_C,
    KEY_E
} from 'playcanvas';
import { localizeRoot } from './localization.mjs';

export class RoomPlayerController extends Script {
    static scriptName = 'roomPlayerController';

    /**
     * @attribute
     * @title Camera
     * @type {Entity}
     */
    camera = null;

    /**
     * @attribute
     * @title Move Joystick Entity
     * @type {Entity}
     */
    moveJoystickEntity = null;

    /**
     * @attribute
     * @title Look Joystick Entity
     * @type {Entity}
     */
    lookJoystickEntity = null;

    /**
     * @attribute
     * @title Bed Lie Point
     * @type {Entity}
     */
    bedLiePoint = null;

    /**
     * @attribute
     * @title Bed Exit Point
     * @type {Entity}
     */
    bedExitPoint = null;

    /** @attribute @title Walk Speed */
    walkSpeed = 1.7;

    /** @attribute @title Run Speed */
    runSpeed = 3.2;

    /** @attribute @title Crouch Speed */
    crouchSpeed = 1.0;

    /** @attribute @title Look Sensitivity */
    lookSensitivity = 0.12;

    /** @attribute @title Bed Use Distance */
    bedUseDistance = 1.7;

    // Character dimensions
    standingHeight = 1.8;
    crouchHeight = 1.15;

    standingEyeHeight = 0.72;
    crouchEyeHeight = 0.50;

    initialize() {
        console.log('[RoomPlayerController] Initialized');

        if (!this.camera) {
            console.error('Camera reference is missing.');
            return;
        }

        if (!this.entity.rigidbody || !this.entity.collision) {
            console.error('Player needs Rigidbody and Collision.');
            return;
        }

        if (this.entity.collision.type !== 'capsule') {
            console.error('Player Collision must be Capsule.');
            return;
        }

        this.isCrouched = false;
        this.isLying = false;

        this.yaw = this.camera.getLocalEulerAngles().y;
        this.pitch = this.camera.getLocalEulerAngles().x;

        // Set standing camera height
        this.camera.setLocalPosition(
            0,
            this.standingEyeHeight,
            0
        );

        this.camera.setLocalEulerAngles(
            this.pitch,
            this.yaw,
            0
        );

        // Mouse input
        if (this.app.mouse) {
            this.app.mouse.on(
                'mousemove',
                this.onMouseMove,
                this
            );

            this.app.mouse.on(
                'mousedown',
                this.onMouseDown,
                this
            );
        }

        // Right-side joystick is replaced by swipe look control.
        if (this.lookJoystickEntity) {
            const hideEntityTree = (entity) => {
                if (!entity) return;
                entity.enabled = false;
                for (const child of entity.children ?? []) {
                    hideEntityTree(child);
                }
            };
            hideEntityTree(this.lookJoystickEntity);
        }

        this.setupTouchLookSwipe();

        // Keyboard interaction events
        if (this.app.keyboard) {
            this.app.keyboard.on(
                'keydown',
                this.onKeyDown,
                this
            );
        }

        this.createTouchBedButton();
        this._onWorkBrowserActive = (active) => {
            this._workBrowserActive = !!active;
            this._touchLookActive = false;
            this._touchLookPointerId = null;
            this.updateTouchBedButton();
        };
        this.app.on('work-browser:active', this._onWorkBrowserActive, this);
        this._onSceneInteractionActive = (active) => {
            this._sceneInteractionActive = !!active;
            this._touchLookActive = false;
            this._touchLookPointerId = null;
            this.updateTouchBedButton();
        };
        this.app.on('scene-interaction:active', this._onSceneInteractionActive, this);

        this.on('destroy', this.destroy, this);
    }

    createTouchBedButton() {
        if (typeof document === 'undefined') return;

        const isTouchDevice = !!this.app.touch ||
            (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
            (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

        if (!isTouchDevice) return;

        this.touchBedButton = document.createElement('button');
        this.touchBedButton.type = 'button';
        this.touchBedButton.dataset.workControl = 'true';
        this.touchBedButton.setAttribute('aria-label', 'Lie down or get up');
        this.touchBedButton.innerHTML = `
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <circle cx="8" cy="10" r="3" fill="currentColor" stroke="none"/>
                <path d="M5 17h22a3 3 0 0 1 3 3v5H2v-5a3 3 0 0 1 3-3Z"/>
                <path d="M2 25v4M30 25v4M11 17v8"/>
            </svg>
        `;
        this._touchBedIcon = this.touchBedButton.innerHTML;
        this._touchBookIcon = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 8C12 5 7 5 3 6v19c5-1 9 0 13 3 4-3 8-4 13-3V6c-4-1-9-1-13 2Z"/>
            <path d="M16 8v20M7 11c2 0 4 .5 6 1.5M7 16c2 0 4 .5 6 1.5M19 12.5c2-1 4-1.5 6-1.5M19 17.5c2-1 4-1.5 6-1.5"/>
        </svg>`;

        Object.assign(this.touchBedButton.style, {
            position: 'fixed',
            right: 'calc(env(safe-area-inset-right, 0px) + 24px)',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 110px)',
            width: '76px',
            height: '76px',
            display: 'none',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            border: '1px solid rgba(255,255,255,0.38)',
            borderRadius: '50%',
            background: 'rgba(20,20,20,0.38)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: '700',
            lineHeight: '1',
            boxSizing: 'border-box',
            opacity: '0.72',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            zIndex: '900'
        });

        this._onTouchBedButton = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this._workBrowserActive || this._sceneInteractionActive) return;

            if (this.isLying) {
                this.exitBed();
            } else if (this._touchInteractionTarget && this._touchInteractionManager?.enabled) {
                const manager = this._touchInteractionManager;
                // Re-pick on activation: a stale icon must never open a target
                // which has moved out of range or behind an obstruction.
                const target = manager.pickAtScreenCenter();
                if (target === this._touchInteractionTarget) manager.openInteraction(target);
            } else {
                this.tryEnterBed();
            }

            this.updateTouchBedButton();
        };

        this._onTouchInteractionPointerDown = (event) => event.stopPropagation();
        this.touchBedButton.addEventListener('pointerdown', this._onTouchInteractionPointerDown);
        this.touchBedButton.addEventListener('click', this._onTouchBedButton);
        document.body.appendChild(this.touchBedButton);
        this._disposeBedLocalization = localizeRoot(this.touchBedButton);

        this._updateTouchBedPosition = () => {
            if (!this.touchBedButton) return;

            const portrait = window.innerHeight > window.innerWidth;
            if (portrait) {
                this.touchBedButton.style.right = 'calc(env(safe-area-inset-right, 0px) + 20px)';
                this.touchBedButton.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 190px)';
            } else {
                this.touchBedButton.style.right = 'calc(env(safe-area-inset-right, 0px) + 24px)';
                this.touchBedButton.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 110px)';
            }
        };

        window.addEventListener('resize', this._updateTouchBedPosition);
        window.addEventListener('orientationchange', this._updateTouchBedPosition);
        this._updateTouchBedPosition();
    }

    updateTouchBedButton() {
        if (!this.touchBedButton) return;
        const target = this._touchInteractionManager?.enabled ? this._touchInteractionTarget : null;
        const position = this.entity.getPosition();
        const bedside = this.bedExitPoint?.getPosition();
        const nearBed = !!(this.bedLiePoint && bedside &&
            Math.hypot(position.x - bedside.x, position.z - bedside.z) <= this.bedUseDistance);
        const visible = !this._workBrowserActive && !this._sceneInteractionActive &&
            (this.isLying || !!target || nearBed);
        this.touchBedButton.style.display = visible ? 'flex' : 'none';
        const kind = this.isLying ? 'get-up' : target ? 'notebook' : 'bed';
        if (this._touchInteractionKind !== kind) {
            this._touchInteractionKind = kind;
            this.touchBedButton.innerHTML = kind === 'notebook' ? this._touchBookIcon : this._touchBedIcon;
            this.touchBedButton.setAttribute('aria-label',
                kind === 'notebook' ? 'Read Notebook' : kind === 'get-up' ? 'Get up' : 'Lie down');
        }
    }

    setTouchInteractionTarget(target, manager) {
        this._touchInteractionTarget = target;
        this._touchInteractionManager = manager;
        this.updateTouchBedButton();
    }

    onKeyDown(event) {
        if (this._workBrowserActive || this._sceneInteractionActive || event.event?.defaultPrevented) return;

        // Browser overlays own keyboard focus while an address field or iframe
        // is active; do not trigger game shortcuts behind that UI.
        const focusedElement = typeof document !== 'undefined' ? document.activeElement : null;
        if (focusedElement instanceof HTMLInputElement ||
            focusedElement instanceof HTMLTextAreaElement ||
            focusedElement instanceof HTMLIFrameElement ||
            focusedElement?.isContentEditable) {
            return;
        }

        // Ignore repeated keydown events
        if (event.repeat) return;

        console.log('[Input] Key pressed:', event.key);

        // E: Enter bed or get up
        if (event.key === KEY_E) {
            console.log('[Input] E detected');

            if (this.isLying) {
                this.exitBed();
            } else {
                this.tryEnterBed();
            }
        }

        // C: Toggle crouching
        if (event.key === KEY_C && !this.isLying) {
            this.toggleCrouch();
        }
    }

    onMouseDown(event) {
        if (this._sceneInteractionActive || this.isWorkOverlayInput(event)) return;
        this.app.mouse.enablePointerLock();
    }

    isWorkOverlayInput(event) {
        if (typeof document === 'undefined') return false;

        // PlayCanvas MouseEvent stores the native event in `event`; some
        // browser paths expose the target directly instead.
        const target = event?.event?.target ?? event?.target ?? document.activeElement;
        const activeElement = document.activeElement;
        if ((target instanceof Element && target.closest('[data-work-control]')) ||
            (activeElement instanceof Element && activeElement.closest('[data-work-control]'))) return true;
        const workRoot = document.getElementById('work-overlay-root');
        if (!workRoot || workRoot.style.display === 'none') return false;
        return (target instanceof Node && workRoot.contains(target)) ||
            (activeElement instanceof Node && workRoot.contains(activeElement));
    }

    onMouseMove(event) {
        if (this._sceneInteractionActive) return;
        if (!Mouse.isPointerLocked()) {
            return;
        }

        // Look around while lying on the bed
        
        if (this.isLying) {
            // Horizontal rotation: unlimited
            this.bedYaw +=
                event.dx * this.lookSensitivity;

            // Vertical rotation: wider range
            const newPitch =
                this.bedPitch -
                event.dy * this.lookSensitivity;

            this.bedPitch = Math.max(
                this.bedBasePitch - 70,
                Math.min(
                    this.bedBasePitch + 70,
                    newPitch
                )
            );

            this.camera.setEulerAngles(
                this.bedPitch,
                this.bedYaw,
                this.bedRoll
            );

            return;
        }

        // Normal first-person look
        this.yaw -= event.dx * this.lookSensitivity;
        this.pitch = Math.max(-80, Math.min(80, this.pitch - event.dy * this.lookSensitivity));

        this.camera.setLocalEulerAngles(
            this.pitch,
            this.yaw,
            0
        );
    }

    setupTouchLookSwipe() {
        if (!this.app.touch) return;

        const canvas = this.app.graphicsDevice?.canvas;
        if (!canvas) return;

        this._touchLookActive = false;
        this._touchLookPointerId = null;
        this._touchLookLastX = 0;
        this._touchLookLastY = 0;

        this._onTouchLookStart = (event) => {
            if (this._sceneInteractionActive) return;
            if (!event.changedTouches?.length) return;
            const touch = event.changedTouches[0];
            if (event.target !== canvas) return;

            this._touchLookActive = true;
            this._touchLookPointerId = touch.identifier;
            this._touchLookLastX = touch.clientX;
            this._touchLookLastY = touch.clientY;
        };

        this._onTouchLookMove = (event) => {
            if (this._sceneInteractionActive || !this._touchLookActive) return;

            let touch = null;
            for (const candidate of event.changedTouches ?? []) {
                if (candidate.identifier === this._touchLookPointerId) {
                    touch = candidate;
                    break;
                }
            }
            if (!touch) return;

            const dx = touch.clientX - this._touchLookLastX;
            const dy = touch.clientY - this._touchLookLastY;
            this._touchLookLastX = touch.clientX;
            this._touchLookLastY = touch.clientY;

            // Standing horizontal look uses the camera's local yaw direction.
            this.yaw -= dx * this.lookSensitivity;
            const verticalDelta = -dy * this.lookSensitivity;
            this.pitch = Math.max(-80, Math.min(80, this.pitch + verticalDelta));

            if (this.isLying) {
                this.bedYaw += dx * this.lookSensitivity;
                this.bedPitch = Math.max(
                    this.bedBasePitch - 70,
                    Math.min(this.bedBasePitch + 70, this.bedPitch - dy * this.lookSensitivity)
                );
                this.camera.setEulerAngles(this.bedPitch, this.bedYaw, this.bedRoll);
            } else {
                this.camera.setLocalEulerAngles(this.pitch, this.yaw, 0);
            }

            event.preventDefault();
        };

        this._onTouchLookEnd = (event) => {
            if (!event.changedTouches?.length) return;

            for (const touch of event.changedTouches) {
                if (touch.identifier === this._touchLookPointerId) {
                    this._touchLookActive = false;
                    this._touchLookPointerId = null;
                    break;
                }
            }
        };

        canvas.addEventListener('touchstart', this._onTouchLookStart, { passive: true });
        canvas.addEventListener('touchmove', this._onTouchLookMove, { passive: false });
        canvas.addEventListener('touchend', this._onTouchLookEnd, { passive: true });
        canvas.addEventListener('touchcancel', this._onTouchLookEnd, { passive: true });
    }

    update(dt) {
        this.updateTouchBedButton();
        const keyboard = this.app.keyboard;

        if (!this.entity.rigidbody) {
            return;
        }

        if (this._workBrowserActive || this._sceneInteractionActive) {
            const velocity = this.entity.rigidbody.linearVelocity;
            this.entity.rigidbody.linearVelocity = new Vec3(0, velocity.y, 0);
            return;
        }

        // Safe keyboard input
        const keyPressed = (key) =>
            keyboard?.isPressed(key) ?? false;

        // Read mobile joystick inputs
        const browserWindow = typeof window !== 'undefined'
            ? /** @type {Window & {
                touchJoypad?: {
                    sticks?: Record<string, { x: number, y: number }>
                }
            }} */ (window)
            : null;

        const moveJoystick = /** @type {(import('playcanvas').Script & {
            axisX: number,
            axisY: number
        }) | null} */ (
            this.moveJoystickEntity?.script?.get('touchJoystick') ?? null
        );

        // Movement input: Keyboard + Left Joystick
        const forwardInput = Math.max(-1, Math.min(1,
            (keyPressed(KEY_W) ? 1 : 0) -
            (keyPressed(KEY_S) ? 1 : 0) +
            (moveJoystick?.axisY ?? 0)
        ));

        const sideInput = Math.max(-1, Math.min(1,
            (keyPressed(KEY_D) ? 1 : 0) -
            (keyPressed(KEY_A) ? 1 : 0) +
            (moveJoystick?.axisX ?? 0)
        ));

        const rad = this.yaw * Math.PI / 180;

        const forwardX = -Math.sin(rad);
        const forwardZ = -Math.cos(rad);

        const rightX = Math.cos(rad);
        const rightZ = -Math.sin(rad);

        let moveX =
            forwardX * forwardInput +
            rightX * sideInput;

        let moveZ =
            forwardZ * forwardInput +
            rightZ * sideInput;

        // Prevent faster diagonal movement
        const length = Math.hypot(moveX, moveZ);

        if (length > 1) {
            moveX /= length;
            moveZ /= length;
        }

        let speed = this.walkSpeed;

        if (this.isCrouched) {
            speed = this.crouchSpeed;
        } else if (keyPressed(KEY_SHIFT)) {
            speed = this.runSpeed;
        }

        // Preserve vertical velocity from gravity
        const oldVelocity =
            this.entity.rigidbody.linearVelocity;

        this.entity.rigidbody.linearVelocity = new Vec3(
            moveX * speed,
            oldVelocity.y,
            moveZ * speed
        );
    }

    toggleCrouch() {
        if (this.isCrouched) {
            if (!this.canStandUp()) {
                console.log('Not enough headroom.');
                return;
            }

            this.resizeBody(
                this.standingHeight,
                this.standingEyeHeight
            );

            this.isCrouched = false;

            console.log('Standing');
        } else {
            this.resizeBody(
                this.crouchHeight,
                this.crouchEyeHeight
            );

            this.isCrouched = true;

            console.log('Crouching');
        }
    }

    resizeBody(newHeight, newEyeHeight) {
        const position = this.entity.getPosition();

        const oldHeight = this.entity.collision.height;

        // Keep feet at the same world height
        const newY =
            position.y +
            (newHeight - oldHeight) * 0.5;

        // Update capsule collision
        this.entity.collision.height = newHeight;

        // Move the rigidbody while preserving its position
        this.entity.rigidbody.teleport(
            position.x,
            newY,
            position.z
        );

        // Preserve vertical velocity, stop horizontal movement
        const velocity =
            this.entity.rigidbody.linearVelocity;

        this.entity.rigidbody.linearVelocity = new Vec3(
            0,
            velocity.y,
            0
        );

        // Update camera eye height
        this.camera.setLocalPosition(
            0,
            newEyeHeight,
            0
        );
    }

    canStandUp() {
        const position = this.entity.getPosition();

        const currentHeight =
            this.entity.collision.height;

        const currentTop =
            position.y + currentHeight * 0.5;

        const feetY =
            position.y - currentHeight * 0.5;

        const targetTop =
            feetY + this.standingHeight;

        const start = new Vec3(
            position.x,
            currentTop + 0.02,
            position.z
        );

        const end = new Vec3(
            position.x,
            targetTop - 0.02,
            position.z
        );

        // Check whether an object blocks the standing position
        const hit = this.app.systems.rigidbody.raycastFirst(
            start,
            end
        );

        return hit === null;
    }

    
    tryEnterBed() {
        if (!this.bedLiePoint || !this.bedExitPoint) {
            console.error('[BED] Bed positions are missing.');
            return;
        }

        // Stand up before entering bed
        if (this.isCrouched) {
            if (!this.canStandUp()) {
                console.warn('[BED] Cannot stand up here.');
                return;
            }

            this.resizeBody(
                this.standingHeight,
                this.standingEyeHeight
            );

            this.isCrouched = false;
        }

        // Player position
        const playerPosition = this.entity.getPosition();

        // Bedside interaction position
        const interactionPosition =
            this.bedExitPoint.getPosition();

        const distance = Math.hypot(
            playerPosition.x - interactionPosition.x,
            playerPosition.z - interactionPosition.z
        );

        console.log('[BED] Distance:', distance);

        if (distance > this.bedUseDistance) {
            console.log('[BED] Too far away.');
            return;
        }

        // Actual camera position on the bed
        const bedPosition = this.bedLiePoint.getPosition();

        const angles = this.bedLiePoint.getEulerAngles();

        this.bedBasePitch = angles.x;
        this.bedPitch = angles.x;
        this.bedYaw = angles.y;
        this.bedRoll = angles.z;

        this.isLying = true;

        // Stop player physics
        this.entity.rigidbody.linearVelocity =
            new Vec3(0, 0, 0);

        this.entity.rigidbody.enabled = false;
        this.entity.collision.enabled = false;

        // Move camera to the actual bed position
        this.camera.setPosition(
            bedPosition.x,
            bedPosition.y,
            bedPosition.z
        );

        this.camera.setEulerAngles(
            angles.x,
            angles.y,
            angles.z
        );

        this.updateTouchBedButton();

        console.log('[BED] Successfully entered bed.');
    }


    exitBed() {
        if (!this.bedExitPoint) {
            return;
        }

        const exitPosition =
            this.bedExitPoint.getPosition();

        const exitAngles =
            this.bedExitPoint.getEulerAngles();

        const x = exitPosition.x;
        const y = exitPosition.y + this.standingHeight * 0.5;
        const z = exitPosition.z;

        // Restore Player position
        this.entity.setPosition(x, y, z);
        this.entity.setEulerAngles(0, 0, 0);

        this.entity.collision.height =
            this.standingHeight;

        this.camera.setLocalPosition(
            0,
            this.standingEyeHeight,
            0
        );

        this.yaw = exitAngles.y;
        this.pitch = 0;

        this.camera.setLocalEulerAngles(
            0,
            this.yaw,
            0
        );

        // Restore physics
        this.entity.collision.enabled = true;
        this.entity.rigidbody.enabled = true;

        this.entity.rigidbody.teleport(
            x,
            y,
            z,
            0,
            0,
            0
        );

        this.isCrouched = false;
        this.isLying = false;

        this.updateTouchBedButton();

        console.log('Got out of bed');
    }

    destroy() {
        this._disposeBedLocalization?.();
        this.app.off('work-browser:active', this._onWorkBrowserActive, this);
        this.app.off('scene-interaction:active', this._onSceneInteractionActive, this);
        const canvas = this.app.graphicsDevice?.canvas;
        if (canvas) {
            if (this._onTouchLookStart) canvas.removeEventListener('touchstart', this._onTouchLookStart);
            if (this._onTouchLookMove) canvas.removeEventListener('touchmove', this._onTouchLookMove);
            if (this._onTouchLookEnd) {
                canvas.removeEventListener('touchend', this._onTouchLookEnd);
                canvas.removeEventListener('touchcancel', this._onTouchLookEnd);
            }
        }

        if (this.app.mouse) {
            this.app.mouse.off(
                'mousemove',
                this.onMouseMove,
                this
            );

            this.app.mouse.off(
                'mousedown',
                this.onMouseDown,
                this
            );

            this.app.mouse.disablePointerLock();
        }

        if (this.app.keyboard) {
            this.app.keyboard.off(
                'keydown',
                this.onKeyDown,
                this
            );
        }

        if (this._updateTouchBedPosition) {
            window.removeEventListener('resize', this._updateTouchBedPosition);
            window.removeEventListener('orientationchange', this._updateTouchBedPosition);
            this._updateTouchBedPosition = null;
        }

        if (this.touchBedButton) {
            this.touchBedButton.removeEventListener('pointerdown', this._onTouchInteractionPointerDown);
            this.touchBedButton.removeEventListener('click', this._onTouchBedButton);
            this.touchBedButton.remove();
            this.touchBedButton = null;
        }
    }
}
