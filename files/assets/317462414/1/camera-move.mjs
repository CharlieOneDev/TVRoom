// @ts-nocheck
import {
    Script,
    Mouse,
    KEY_W,
    KEY_A,
    KEY_S,
    KEY_D,
    KEY_UP,
    KEY_DOWN,
    KEY_LEFT,
    KEY_RIGHT,
    KEY_SHIFT
} from 'playcanvas';

export class CameraMove extends Script {
    static scriptName = 'cameraMove';

    /**
     * @attribute
     * @title Move Speed
     * @type {number}
     */
    moveSpeed = 3;

    /**
     * @attribute
     * @title Look Sensitivity
     * @type {number}
     */
    lookSensitivity = 0.15;

    initialize() {
        // Preserve the camera's original rotation
        const angles = this.entity.getEulerAngles();

        this.yaw = angles.y;
        this.pitch = angles.x;

        // Listen for mouse input
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

        this._onWorkBrowserActive = (active) => {
            this._workBrowserActive = !!active;
        };
        this.app.on('work-browser:active', this._onWorkBrowserActive, this);
        this._onSceneInteractionActive = (active) => {
            this._sceneInteractionActive = !!active;
        };
        this.app.on('scene-interaction:active', this._onSceneInteractionActive, this);
    }

    onMouseDown(event) {
        if (!this.app.mouse || this._sceneInteractionActive || this.isWorkOverlayInput(event)) return;
        // Lock cursor for first-person camera control
        this.app.mouse.enablePointerLock();
    }

    isWorkOverlayInput(event) {
        if (typeof document === 'undefined') return false;

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
        if (!Mouse.isPointerLocked() &&
            !(event.buttons && event.buttons[0])) {
            return;
        }

        this.yaw -= event.dx * this.lookSensitivity;

        this.pitch -= event.dy * this.lookSensitivity;

        // Prevent looking too far up or down
        this.pitch = Math.max(
            -85,
            Math.min(85, this.pitch)
        );

        this.entity.setEulerAngles(
            this.pitch,
            this.yaw,
            0
        );
    }

    update(dt) {
        if (this._workBrowserActive || this._sceneInteractionActive) return;

        const keyboard = this.app.keyboard;

        if (!keyboard) return;

        // Read keyboard input
        const forwardInput =
            ((keyboard.isPressed(KEY_W) ||
              keyboard.isPressed(KEY_UP)) ? 1 : 0) -
            ((keyboard.isPressed(KEY_S) ||
              keyboard.isPressed(KEY_DOWN)) ? 1 : 0);

        const strafeInput =
            ((keyboard.isPressed(KEY_D) ||
              keyboard.isPressed(KEY_RIGHT)) ? 1 : 0) -
            ((keyboard.isPressed(KEY_A) ||
              keyboard.isPressed(KEY_LEFT)) ? 1 : 0);

        // Get camera directions
        const forward = this.entity.forward;
        const right = this.entity.right;

        // Flatten directions onto the horizontal plane
        const forwardLength = Math.hypot(
            forward.x,
            forward.z
        );

        const rightLength = Math.hypot(
            right.x,
            right.z
        );

        let moveX = 0;
        let moveZ = 0;

        if (forwardLength > 0.0001) {
            moveX += forward.x / forwardLength * forwardInput;
            moveZ += forward.z / forwardLength * forwardInput;
        }

        if (rightLength > 0.0001) {
            moveX += right.x / rightLength * strafeInput;
            moveZ += right.z / rightLength * strafeInput;
        }

        // Normalize to prevent faster diagonal movement
        const length = Math.hypot(moveX, moveZ);

        if (length > 0) {
            moveX /= length;
            moveZ /= length;
        }

        // Shift to run
        const speed = this.moveSpeed *
            (keyboard.isPressed(KEY_SHIFT) ? 2.5 : 1);

        // Move camera
        const position = this.entity.getPosition();

        this.entity.setPosition(
            position.x + moveX * speed * dt,
            position.y,
            position.z + moveZ * speed * dt
        );
    }

    destroy() {
        this.app.off('work-browser:active', this._onWorkBrowserActive, this);
        this.app.off('scene-interaction:active', this._onSceneInteractionActive, this);
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
    }
}
