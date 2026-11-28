import { advanceTime, applyAction } from "./game-rules.js";
import { createInitialState } from "./game-state.js";

export function createLocalSession({ onStateChange, now = () => Date.now(), intervalMs = 50 } = {}) {
    let state = createInitialState();
    let clockId = null;

    function publish(result) {
        state = result.state;
        if (onStateChange) {
            onStateChange(state, result.events);
        }
    }

    return {
        getState() {
            return state;
        },
        dispatch(action) {
            publish(applyAction(state, action, now()));
        },
        start() {
            if (clockId === null) {
                clockId = setInterval(() => publish(advanceTime(state, now())), intervalMs);
            }
        },
        stop() {
            if (clockId !== null) {
                clearInterval(clockId);
                clockId = null;
            }
        }
    };
}
