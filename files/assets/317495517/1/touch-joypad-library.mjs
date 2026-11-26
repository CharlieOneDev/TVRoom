// @ts-nocheck
const managers = new WeakMap();

function createJoyPadManager(app) {
    const clickedThresholdMs = 200;
    const prevButtonStates = {};
    const buttonStates = {};

    app.on('update', () => {
        for (let key of Object.keys(buttonStates)) {
            const val = buttonStates[key];
            prevButtonStates[key] = val;
        }
    });

    const touchJoypad = {
        buttons: {
            isPressed: function (name) {
                const state = buttonStates[name];
                return !!state;
            },

            wasPressed: function (name) {
                const state = buttonStates[name];
                const prev = prevButtonStates[name];
                if (buttonStates[name] !== undefined) {
                    return (!prev && state);
                }

                return false;
            },
            
            wasReleased: function (name) {
                const state = buttonStates[name];
                const prev = prevButtonStates[name];
                if (buttonStates[name] !== undefined) {
                    return (prev && !state);
                }

                return false;
            },

            wasTapped: function (name) {
                if (this.wasReleased(name)) {
                    const now = Date.now();
                    return (now - prevButtonStates[name] <= clickedThresholdMs);
                }

                return false;
            }
        },

        sticks: {

        }
    };

    return { buttonStates, touchJoypad };
}

export const getTouchJoyPadManager = (app) => {
    if (!managers.has(app)) {
        managers.set(app, createJoyPadManager(app));
    }

    return managers.get(app);
}
