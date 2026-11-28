import assert from "node:assert/strict";
import { test } from "node:test";
import { createMultiplayerSnapshotController } from "../js/multiplayer-snapshot-controller.js";

function createHarness() {
    const rendered = [];
    const controller = createMultiplayerSnapshotController({
        render(snapshot) {
            rendered.push(snapshot);
        }
    });
    return { controller, rendered };
}

test("accepted snapshots trigger rendering and remain available", () => {
    const harness = createHarness();
    const snapshot = {
        roomId: "ROOM01",
        gameEpoch: 1,
        gameRevision: 1,
        status: "playing",
        players: [{ id: "P1", x: 2, y: 1, alive: true }],
        bombs: [],
        explosions: [],
        map: [[0]]
    };

    harness.controller.accept(snapshot);

    assert.equal(harness.rendered.length, 1);
    assert.deepEqual(harness.controller.getSnapshot(), snapshot);
    assert.equal(harness.controller.isActive(), true);
});

test("new snapshots replace state without changing a separate local state", () => {
    const harness = createHarness();
    const localState = { players: [{ id: 1, x: 8, y: 6 }] };
    const first = {
        roomId: "ROOM01",
        gameEpoch: 1,
        gameRevision: 1,
        status: "playing",
        players: [{ id: "P1", x: 2, y: 1, alive: true }],
        bombs: [],
        explosions: [],
        map: [[0]]
    };
    const second = {
        ...first,
        gameRevision: 2,
        players: [{ id: "P1", x: 3, y: 1, alive: true }]
    };

    harness.controller.accept(first);
    harness.controller.accept(second);

    assert.equal(harness.rendered.length, 2);
    assert.equal(harness.controller.getSnapshot().players[0].x, 3);
    assert.deepEqual(localState.players, [{ id: 1, x: 8, y: 6 }]);
});

test("defensive snapshot copies prevent render mutations", () => {
    const harness = createHarness();
    const snapshot = {
        roomId: "ROOM01",
        gameEpoch: 1,
        gameRevision: 1,
        status: "playing",
        players: [{ id: "P1", x: 2, y: 1, alive: true }],
        bombs: [],
        explosions: [],
        map: [[0]]
    };

    harness.controller.accept(snapshot);
    harness.rendered[0].players[0].x = 99;

    assert.equal(harness.controller.getSnapshot().players[0].x, 2);
});

test("final snapshots remain available and leave clears them", () => {
    const harness = createHarness();
    const finalSnapshot = {
        roomId: "ROOM01",
        gameEpoch: 1,
        gameRevision: 5,
        status: "finished",
        result: { type: "win", winnerId: "P2" },
        players: [{ id: "P1", x: 1, y: 1, alive: false }],
        bombs: [],
        explosions: [],
        map: [[0]]
    };

    harness.controller.finish(finalSnapshot);

    assert.equal(harness.controller.isActive(), false);
    assert.deepEqual(harness.controller.getSnapshot(), finalSnapshot);

    harness.controller.leave();
    assert.equal(harness.controller.getSnapshot(), null);
});

test("playing reset snapshot replaces final state only after authoritative acceptance", () => {
    const harness = createHarness();
    const finalSnapshot = {
        roomId: "ROOM01",
        gameEpoch: 1,
        gameRevision: 5,
        status: "finished",
        result: { type: "win", winnerId: "P2" },
        players: [
            { id: "P1", name: "One", alive: false },
            { id: "P2", name: "Two", alive: true }
        ],
        bombs: [],
        explosions: [],
        map: [[0]]
    };

    harness.controller.finish(finalSnapshot);
    assert.equal(harness.controller.getSnapshot().status, "finished");
    assert.equal(harness.rendered.at(-1).status, "finished");

    const resetSnapshot = {
        ...finalSnapshot,
        gameEpoch: 2,
        gameRevision: 6,
        status: "playing",
        result: null,
        players: finalSnapshot.players.map(player => ({ ...player, alive: true }))
    };
    harness.controller.accept(resetSnapshot);

    assert.equal(harness.controller.isActive(), true);
    assert.equal(harness.controller.getSnapshot().status, "playing");
    assert.equal(harness.controller.getSnapshot().gameEpoch, 2);
    assert.equal(harness.rendered.at(-1).result, null);
});
