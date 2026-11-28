import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalModeController } from "../js/local-mode-controller.js";

function createHarness(initialState = {
    players: [{ id: 1, x: 3, y: 4 }],
    bombs: [],
    explosions: []
}) {
    let state = initialState;
    let startCount = 0;
    let stopCount = 0;
    let attachCount = 0;
    let detachCount = 0;
    let stateChangeSubscriptionCount = 0;

    const session = {
        getState() {
            return state;
        },
        start() {
            startCount += 1;
        },
        stop() {
            stopCount += 1;
        },
        dispatch() {}
    };

    const controller = createLocalModeController({
        createSession(options) {
            stateChangeSubscriptionCount += 1;
            session.onStateChange = options.onStateChange;
            return session;
        },
        attachInput() {
            attachCount += 1;
            return () => {
                detachCount += 1;
            };
        },
        onStateChange() {},
        render() {}
    });

    return {
        controller,
        session,
        setState(nextState) {
            state = nextState;
        },
        counts() {
            return {
                startCount,
                stopCount,
                attachCount,
                detachCount,
                stateChangeSubscriptionCount
            };
        }
    };
}

test("preserves player position and local entities across lobby switching", () => {
    const harness = createHarness();
    harness.controller.ensureStarted();
    harness.setState({
        players: [{ id: 1, x: 8, y: 6 }],
        bombs: [{ x: 7, y: 6 }],
        explosions: [{ x: 7, y: 5 }]
    });

    harness.controller.stop();
    harness.controller.ensureStarted();

    assert.equal(harness.controller.getSession(), harness.session);
    assert.deepEqual(harness.controller.getSession().getState(), {
        players: [{ id: 1, x: 8, y: 6 }],
        bombs: [{ x: 7, y: 6 }],
        explosions: [{ x: 7, y: 5 }]
    });
});

test("stops timing in the lobby and resumes timing when returning", () => {
    const harness = createHarness();
    harness.controller.ensureStarted();
    assert.equal(harness.controller.isActive(), true);

    harness.controller.stop();
    assert.equal(harness.controller.isActive(), false);

    harness.controller.ensureStarted();
    assert.equal(harness.controller.isActive(), true);

    assert.deepEqual(harness.counts(), {
        startCount: 2,
        stopCount: 1,
        attachCount: 2,
        detachCount: 1,
        stateChangeSubscriptionCount: 1
    });
});

test("repeated switching reuses one session without duplicate timers or handlers", () => {
    const harness = createHarness();

    for (let index = 0; index < 3; index += 1) {
        harness.controller.ensureStarted();
        harness.controller.stop();
    }

    harness.controller.ensureStarted();

    assert.equal(harness.controller.getSession(), harness.session);
    assert.deepEqual(harness.counts(), {
        startCount: 4,
        stopCount: 3,
        attachCount: 4,
        detachCount: 3,
        stateChangeSubscriptionCount: 1
    });
});

test("local replay dispatches through the existing session reset mechanism", () => {
    const harness = createHarness({
        status: "finished",
        result: { type: "win", winnerId: 1 },
        players: [{ id: 1, x: 3, y: 4, alive: true }],
        bombs: [],
        explosions: []
    });
    let resetCount = 0;
    harness.session.dispatch = (action) => {
        if (action.type === "reset" && action.playerId === 1) {
            resetCount += 1;
        }
    };

    harness.controller.ensureStarted();
    harness.session.dispatch({ type: "reset", playerId: 1 });

    assert.equal(resetCount, 1);
    assert.equal(harness.controller.getSession(), harness.session);
});
