import { Script } from 'playcanvas';
import { getTouchJoyPadManager } from './touch-joypad-library.mjs'
/**
 * TouchButton enables touch and mouse input with optional vibration and unique button identifier.
 */
export class TouchButton extends Script {
    static scriptName = 'touchButton';

    /**
     * A unique name for the button to refer to it by in the API.
     * 
     * @attribute
     * @type {string}
     * @default "button0"
     */
    identifier = 'button0';

    /**
     * If the device supports vibration, this value determines how long (in ms) it will vibrate.
     * Set to 0 to disable.
     * 
     * @attribute
     * @type {number}
     * @default 0
     */
    vibration = 0;

    initialize() {

        const { touchJoypad, buttonStates } = getTouchJoyPadManager(this.app);
        this.touchJoypad = touchJoypad;
        this.buttonStates = buttonStates;

        // Warn if identifier already used
        if (this.buttonStates[this.identifier] !== undefined) {
            console.warn(`Touch button identifier already used, please use another for Entity: ${this.entity.name}`);
            return;
        }

        this._canVibrate = !!navigator.vibrate;
        this._state = false;

        this._setState(false);

        this.on('state', (state) => {
            this._setEvents(state ? 'on' : 'off');
        });

        this.on('destroy', () => {
            this.buttonStates[this.identifier] = undefined;
        });

        this._setEvents('on');
    }

    /** @param {'on' | 'off'} mode */
    _setEvents(mode) {
        this._state = false;

        const el = this.entity.element;
        if (!el) return;

        el[mode]('mousedown', this._onMouseDown, this);
        el[mode]('mouseup', this._onMouseUp, this);

        if (this.app.touch) {
            el[mode]('touchstart', this._onTouchDown, this);
            el[mode]('touchend', this._onTouchUp, this);
            el[mode]('touchcancel', this._onTouchUp, this);
        }
    }

    /** @param {MouseEvent} e */
    _onMouseDown(e) {
        if (!this._state) {
            this._onPointerDown();
            e.stopPropagation();
        }
    }

    /** @param {MouseEvent} e */
    _onMouseUp(e) {
        if (this._state) {
            this._onPointerUp();
            e.stopPropagation();
        }
    }

    /**
     * @param {TouchEvent} e
     */
    _onTouchDown(e) {
        if (!this._state) {
            this._onPointerDown();
            e.stopPropagation();
        }
    }

    /** @param {*} e */
    _onTouchUp(e) {
        if (this._state) {
            this._onPointerUp();
            e.stopPropagation();
        }
        if (e.event?.preventDefault) {
            e.event.preventDefault();
        }
    }

    _onPointerDown() {
        if (this._canVibrate && this.vibration > 0) {
            navigator.vibrate(this.vibration);
        }
        this._setState(true);
    }

    _onPointerUp() {
        this._setState(false);
    }

    /** @param {boolean} state */
    _setState(state) {
        this.buttonStates[this.identifier] = state ? Date.now() : null;
        this._state = state;
    }
}
