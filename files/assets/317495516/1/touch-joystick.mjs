// @ts-nocheck
import { Vec2, Vec3, math } from 'playcanvas';
import { Script } from 'playcanvas';
import { getTouchJoyPadManager } from './touch-joypad-library.mjs'

/** @enum {string} */
const JoystickTypeEnum = {
    /**
     * @title Fixed in place
     */
    FIXED : "fixed",

    /**
     * @title Move to first touch and fixed
     */
    RELATIVE : "relative",

    /**
     * @title Move to first touch and drags
     */
    DRAG: "drag"
}

/**
 * TouchJoystick - A touch-based joystick controller for UI control in PlayCanvas.
 */
export class TouchJoystick extends Script {
    static scriptName = 'touchJoystick';

    static __uiPos = new Vec2();
    static __tempNubPos = new Vec3();
    static __tempBasePos = new Vec3();

    /**
     * A unique name for the joystick to refer to it by in the API. Joysticks are also buttons so this will also be the name of button in the API. It will give a warning in browser tools if the name is not unique.
     *
     * @attribute
     * @title Idenitifier
     * @type {string}
     */
    identifier = 'joystick0';

    /**
     * Set type of behavior for the joystick.
     *
     * @attribute
     * @title Type
     * @type {JoystickTypeEnum}
     */
    type = JoystickTypeEnum.FIXED;

    /**
     * Image Element Entity that shows the base of the joystick.
     *
     * @attribute
     * @title Base Entity
     * @type {pc.Entity}
     */
    baseEntity;

    /**
     * Image Element Entity that shows the nub (top) of the joystick.
     *
     * @attribute
     * @title Nub Entity
     * @type {pc.Entity}
     */
    nubEntity;

    /**
     * The number of UI units from the position of the Base Entity where input is not registered.
     *
     * @attribute
     * @title Axis Dead Zone
     * @type {number}
     */
    axisDeadZone = 10;

    /**
     * The number of UI units from the position of the Base Entity that the Nub Entity can move to and is the maximum range.
     *
     * @attribute
     * @title Axis Range
     * @type {number}
     */
    axisRange = 50;

    /**
     * Will only show the joystick when the user is using it and will hide it on touch end. This is commonly used if you don't want the joystick to block what's being shown on screen.
     *
     * @attribute
     * @title Hide on Release
     * @type {boolean}
     */
    hideOnRelease = false;

    /**
     * Where to move the joystick on release and can help keep the screen tidy so that there are clear areas to show the game and arrange controls.
     *
     * @attribute
     * @title Position on Release
     * @type {string}
     */
    positionOnRelease = 'stay';

    /**
     * If the device supports vibration with 'Navigator.vibrate', it will vibrate for the duration set here on touch down. Set to 0 to disable.
     *
     * @attribute
     * @title Vibration duration (ms)
     * @type {number}
     */
    vibrationPress = 0;

    /**
     * The opacity of the joystick base.
     *
     * @attribute
     * @title Base Opacity
     * @type {number}
     */
    baseOpacity = 0.5;

    /**
     * The opacity of the joystick nub.
     *
     * @attribute
     * @title Nub Opacity
     * @type {number}
     */
    nubOpacity = 0.5;

    initialize() {

        const { touchJoypad, buttonStates } = getTouchJoyPadManager(this.app);
        this.touchJoypad = touchJoypad;
        this.buttonStates = buttonStates;

        if (this.touchJoypad.sticks[this.identifier] !== undefined) {
            console.warn('Touch joystick identifier already used, please use another for Entity: ' + this.entity.name);
            return;
        }

        this.isTouchDevice = !!this.app.touch ||
            (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
            (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

        this.entity.enabled = this.isTouchDevice;
        if (this.baseEntity) {
            this.baseEntity.enabled = this.isTouchDevice;
            if (this.baseEntity.element) {
                const opacity = Number(this.baseOpacity);
                this.baseEntity.element.opacity = Number.isFinite(opacity)
                    ? Math.min(1, Math.max(0, opacity))
                    : 0.5;
            }
        }
        if (this.nubEntity) {
            this.nubEntity.enabled = this.isTouchDevice;
            if (this.nubEntity.element) {
                const opacity = Number(this.nubOpacity);
                this.nubEntity.element.opacity = Number.isFinite(opacity)
                    ? Math.min(1, Math.max(0, opacity))
                    : 0.5;
            }
        }

        if (!this.isTouchDevice) return;

        this._originalLocalPosition = this.baseEntity.getLocalPosition().clone();
        this._lastPointerDownPosition = new Vec3();

        this._setAxisValues(0, 0);
        this._inputDown = false;
        this._pointerId = -1;

        this._canVibrate = !!navigator.vibrate;

        this._setButtonState(false);

        this.on('state', (state) => {
            this._setEvents(state ? 'on' : 'off');
        });

        this.on('destroy', () => {
            this.touchJoypad.sticks[this.identifier] = undefined;
        });

        this._setEvents('on');
    }

    _setEvents(offOn) {
        this._setAxisValues(0, 0);
        this._pointerDown = false;
        this._pointerId = -1;

        this.baseEntity.enabled = !this.hideOnRelease;

        this.entity.element[offOn]('mousedown', this._onMouseDown, this);
        this.entity.element[offOn]('mousemove', this._onMouseMove, this);
        this.entity.element[offOn]('mouseup', this._onMouseUp, this);

        if (this.app.touch) {
            this.entity.element[offOn]('touchstart', this._onTouchDown, this);
            this.entity.element[offOn]('touchmove', this._onTouchMove, this);
            this.entity.element[offOn]('touchend', this._onTouchUp, this);
            this.entity.element[offOn]('touchcancel', this._onTouchUp, this);
        }
    }

    screenToUi(screenPosition) {
        const uiPos = TouchJoystick.__uiPos;

        const canvasWidth = this.app.graphicsDevice.canvas.clientWidth;
        const canvasHeight = this.app.graphicsDevice.canvas.clientHeight;

        uiPos.x = screenPosition.x / canvasWidth;
        uiPos.y = screenPosition.y / canvasHeight;

        uiPos.mulScalar(2).subScalar(1);
        uiPos.y *= -1;

        return uiPos;
    }

    _onMouseDown = (e) => {
        e.id = 0;
        this._onPointerDown(e);
        if (this._pointerDown) {
            e.stopPropagation();
        }
    };

    _onMouseMove = (e) => {
        e.id = 0;
        this._onPointerMove(e);
        if (this._pointerDown) {
            e.stopPropagation();
        }
    };

    _onMouseUp = (e) => {
        e.id = 0;
        if (this._pointerDown) {
            e.stopPropagation();
        }
        this._onPointerUp(e);
    };

    _onTouchDown = (e) => {
        if (this._pointerDown) return;

        const wasPointerDown = this._pointerDown;
        e.id = e.touch.identifier;
        this._onPointerDown(e);

        if (!wasPointerDown && this._pointerDown) {
            e.stopPropagation();
        }
    };

    _onTouchMove = (e) => {
        e.id = e.touch.identifier;
        this._onPointerMove(e);

        if (this._pointerDown) {
            e.stopPropagation();
        }

        e.event.preventDefault();
    };

    _onTouchUp = (e) => {
        if (this._pointerDown) {
            e.id = e.touch.identifier;
            this._onPointerUp(e);
            e.stopPropagation();
        }

        e.event.preventDefault();
    };

    _onPointerDown(pointer) {
        const uiPos = this.screenToUi(pointer);
        switch (this.type) {
            case 'drag':
            case 'relative':
                this.baseEntity.setPosition(uiPos.x, uiPos.y, 0);
                this.nubEntity.setLocalPosition(0, 0, 0);
                this._pointerDown = true;
                break;
            case 'fixed':
                this.nubEntity.setPosition(uiPos.x, uiPos.y, 0);
                this._updateAxisValuesFromNub();
                this._pointerDown = true;
                break;
        }

        if (this._pointerDown) {
            if (this._canVibrate && this.vibrationPress !== 0) {
                navigator.vibrate(this.vibrationPress);
            }

            this._pointerId = pointer.id ? pointer.id : 0;
            this._setButtonState(true);
            this._lastPointerDownPosition.copy(this.baseEntity.getLocalPosition());
            this.baseEntity.enabled = true;

            this._onPointerMove(pointer);
        }
    }

    _onPointerMove(pointer) {
        if (this._pointerDown && this._pointerId === pointer.id) {
            const uiPos = this.screenToUi(pointer);
            const axisRangeSq = this.axisRange * this.axisRange;
            this.nubEntity.setPosition(uiPos.x, uiPos.y, 0);

            const nubPos = TouchJoystick.__tempNubPos;
            nubPos.copy(this.nubEntity.getLocalPosition());

            const nubLengthSq = nubPos.lengthSq();

            if (nubLengthSq >= axisRangeSq) {
                if (this.type === 'drag') {
                    const distanceDiff = nubPos.length() - this.axisRange;
                    const basePos = TouchJoystick.__tempBasePos;
                    basePos.copy(nubPos);
                    basePos.normalize().mulScalar(distanceDiff);
                    basePos.add(this.baseEntity.getLocalPosition());
                    this.baseEntity.setLocalPosition(basePos);
                }

                nubPos.normalize().mulScalar(this.axisRange);
                this.nubEntity.setLocalPosition(nubPos);
            }

            this._updateAxisValuesFromNub();
        }
    }

    _onPointerUp(pointer) {
        if (this._pointerDown && this._pointerId === pointer.id) {
            this.nubEntity.setLocalPosition(0, 0, 0);
            if (this.hideOnRelease) {
                this.baseEntity.enabled = false;
            }

            switch (this.positionOnRelease) {
                case 'original':
                    this.baseEntity.setLocalPosition(this._originalLocalPosition);
                    break;
                case 'lastStart':
                    this.baseEntity.setLocalPosition(this._lastPointerDownPosition);
                    break;
            }

            this._pointerId = -1;
            this._updateAxisValuesFromNub();
            this._setButtonState(false);
            this._pointerDown = false;
        }
    }

    _updateAxisValuesFromNub() {
        const axisRange = this.axisRange - this.axisDeadZone;

        const nubPos = this.nubEntity.getLocalPosition();
        const signX = Math.sign(nubPos.x);
        const signY = Math.sign(nubPos.y);

        const axisX = math.clamp(Math.abs(nubPos.x) - this.axisDeadZone, 0, axisRange) * signX;
        const axisY = math.clamp(Math.abs(nubPos.y) - this.axisDeadZone, 0, axisRange) * signY;

        this._setAxisValues(axisX / axisRange, axisY / axisRange);
    }

    _setAxisValues(x, y) {
        if (this.touchJoypad) {
            this.touchJoypad.sticks[this.identifier] = { x, y };
        }

        this.axisX = x;
        this.axisY = y;
    }

    _setButtonState(state) {
        this.buttonStates[this.identifier] = state ? Date.now() : null;
        this._state = state;
    }
}