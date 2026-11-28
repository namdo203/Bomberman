import assert from "node:assert/strict";
import { test } from "node:test";
import {
    attachInputController,
    toMultiplayerAction
} from "../js/input-controller.js";

class FakeTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(eventName, listener) {
        this.listeners.set(eventName, listener);
    }

    removeEventListener(eventName, listener) {
        if (this.listeners.get(eventName) === listener) {
            this.listeners.delete(eventName);
        }
    }

    trigger(key) {
        this.listeners.get("keydown")?.({
            key,
            preventDefault() {}
        });
    }
}

test("keyboard mapping remains unchanged for local input", () => {
    const target = new FakeTarget();
    const actions = [];
    const detach = attachInputController({
        target,
        dispatch: action => actions.push(action)
    });

    target.trigger("ArrowUp");
    target.trigger(" ");

    assert.deepEqual(actions.map(action => [action.type, action.dx, action.dy]), [
        ["move", 0, -1],
        ["place-bomb", undefined, undefined]
    ]);
    detach();
    assert.equal(target.listeners.size, 0);
});

test("multiplayer mapping sends directions and bomb actions", () => {
    const target = new FakeTarget();
    const actions = [];
    const detach = attachInputController({
        target,
        dispatch: action => actions.push(action),
        actionMapper: toMultiplayerAction
    });

    target.trigger("ArrowUp");
    target.trigger("ArrowDown");
    target.trigger("ArrowLeft");
    target.trigger("ArrowRight");
    target.trigger(" ");
    target.trigger("r");

    assert.deepEqual(actions, [
        { type: "move", direction: "up" },
        { type: "move", direction: "down" },
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "place-bomb" }
    ]);
    detach();
});
