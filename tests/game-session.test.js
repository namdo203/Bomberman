import assert from "node:assert/strict";
import { test } from "node:test";
import { GameSession } from "../server/game-session.js";

const participants = [
    { playerId: "P1", displayName: "One" },
    { playerId: "P2", displayName: "Two" },
    { playerId: "P3", displayName: "Three" },
    { playerId: "P4", displayName: "Four" }
];

function createSession(count = 2, options = {}) {
    return new GameSession("ROOM01", participants.slice(0, count), options);
}

function fakeTimers() {
    const callbacks = new Map();
    let nextId = 1;
    return {
        setInterval(callback) {
            const id = nextId++;
            callbacks.set(id, callback);
            return id;
        },
        clearInterval(id) {
            callbacks.delete(id);
        },
        run() {
            for (const callback of callbacks.values()) {
                callback();
            }
        },
        get size() {
            return callbacks.size;
        }
    };
}

test("initialization assigns join-order spawns and isolates sessions", () => {
    const first = createSession(4);
    const second = createSession(2);
    assert.deepEqual(first.getSnapshot().players.map(player => [player.id, player.x, player.y]), [
        ["P1", 1, 1], ["P2", 13, 1], ["P3", 1, 11], ["P4", 13, 11]
    ]);
    first.processAction("P1", { type: "move", direction: "right" }, 0);
    assert.equal(second.getSnapshot().players[0].x, 1);
});

test("actions translate protocol intents, validate identity and sequences", () => {
    const session = createSession();
    assert.equal(session.processAction("unknown", { type: "move", direction: "right" }, 0).ok, false);
    assert.equal(session.processAction("P1", { type: "move", direction: "right" }, 0).changed, true);
    assert.equal(session.getSnapshot().players[0].x, 2);
    assert.equal(session.processAction("P1", { type: "move", direction: "right" }, 0).error.code, "INVALID_SEQUENCE");
    assert.equal(session.processAction("P1", { type: "move", direction: "invalid" }, 3).error.code, "INVALID_ACTION");
    assert.equal(session.processAction("P1", { type: "place-bomb", playerId: "P2" }, 4).changed, true);
    assert.equal(session.getSnapshot().bombs[0].ownerId, "P1");
});

test("rejected and no-op actions do not change revisions", () => {
    const session = createSession();
    assert.equal(session.processAction("P1", { type: "move", direction: "up" }, 0).changed, false);
    assert.equal(session.getSnapshot().gameRevision, 0);
    assert.equal(session.processAction("P1", { type: "move", direction: "left" }, 1).changed, false);
    assert.equal(session.getSnapshot().gameRevision, 0);
    assert.equal(session.processAction("P1", { type: "move", direction: "right" }, 2).changed, true);
    assert.equal(session.getSnapshot().gameRevision, 1);
});

test("controlled time advances bombs, explosions, chain reactions, and completion", () => {
    let now = 0;
    const session = createSession(2, { clock: () => now });
    session.processAction("P1", { type: "place-bomb" }, 0);
    session.processAction("P1", { type: "move", direction: "right" }, 1);
    session.processAction("P1", { type: "place-bomb" }, 2);
    now = 3000;
    const tick = session.tick();
    assert.equal(tick.changed, true);
    assert.deepEqual(session.getSnapshot().bombs, []);
    assert.equal(session.getSnapshot().status, "finished");
    assert.deepEqual(session.getSnapshot().result, { type: "win", winnerId: "P2" });
    assert.deepEqual(
        session.getEvents().filter(event => event.type === "bomb-exploded").map(event => event.bombId),
        [1, 2]
    );
});

test("external elimination preserves records and produces win or draw", () => {
    const session = createSession();
    assert.equal(session.eliminateParticipant("P1").changed, true);
    assert.equal(session.getSnapshot().players.length, 2);
    assert.deepEqual(session.getSnapshot().result, { type: "win", winnerId: "P2" });
    assert.equal(session.eliminateParticipant("P1").ok, false);
    assert.equal(session.eliminateParticipant("unknown").ok, false);

    let drawNow = 0;
    const draw = createSession(2, { clock: () => drawNow });
    draw.processAction("P1", { type: "place-bomb" }, 0);
    draw.processAction("P2", { type: "place-bomb" }, 0);
    drawNow = 3000;
    assert.equal(draw.tick().changed, true);
    assert.deepEqual(draw.getSnapshot().result, { type: "draw", winnerId: null });
});

test("timers stop at completion and disposal is idempotent", () => {
    let now = 0;
    const timers = fakeTimers();
    const session = createSession(2, {
        clock: () => now,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval
    });
    session.start();
    assert.equal(timers.size, 1);
    session.eliminateParticipant("P1");
    assert.equal(timers.size, 0);
    session.dispose();
    session.dispose();
    assert.equal(timers.size, 0);
});

test("reset is restricted to finished matches and preserves identities and spawns", () => {
    const session = createSession();
    assert.equal(session.reset().error.code, "INVALID_ROOM_STATE");
    const initialRevision = session.getSnapshot().gameRevision;
    session.processAction("P1", { type: "move", direction: "right" }, 0);
    session.eliminateParticipant("P1");
    const finishedRevision = session.getSnapshot().gameRevision;
    const reset = session.reset();
    assert.equal(reset.ok, true);
    assert.equal(session.getSnapshot().gameRevision > finishedRevision, true);
    assert.deepEqual(session.getSnapshot().players.map(player => ({
        id: player.id, name: player.name, x: player.x, y: player.y, alive: player.alive
    })), [
        { id: "P1", name: "One", x: 1, y: 1, alive: true },
        { id: "P2", name: "Two", x: 13, y: 1, alive: true }
    ]);
    assert.equal(session.processAction("P1", { type: "move", direction: "right" }, 1).ok, true);
    assert.equal(session.getSnapshot().gameRevision > initialRevision, true);
});

test("epochs reject old-match actions without consuming sequences", () => {
    const session = createSession();
    assert.equal(
        session.processAction("P1", { type: "move", direction: "right" }, 0, 1).changed,
        true
    );
    session.eliminateParticipant("P1");
    const reset = session.reset("P2", 0, 1);
    assert.equal(reset.ok, true);
    assert.equal(session.getSnapshot().gameEpoch, 2);
    const revision = session.getSnapshot().gameRevision;

    const stale = session.processAction("P1", { type: "move", direction: "right" }, 1, 1);
    assert.equal(stale.error.code, "INVALID_GAME_EPOCH");
    assert.equal(session.getSnapshot().gameRevision, revision);
    assert.equal(
        session.processAction("P1", { type: "move", direction: "right" }, 1, 2).ok,
        true
    );
    assert.equal(
        session.reset("P2", 1, 1).error.code,
        "INVALID_GAME_EPOCH"
    );
});

test("reset restores only explicitly eligible participants", () => {
    const session = createSession(4);
    session.eliminateParticipant("P1");
    session.eliminateParticipant("P2");
    session.eliminateParticipant("P3");
    const reset = session.reset("P4", 0, 1, [
        { playerId: "P3", displayName: "Three" },
        { playerId: "P4", displayName: "Four" }
    ]);
    assert.equal(reset.ok, true);
    assert.deepEqual(
        session.getSnapshot().players.map(player => ({
            id: player.id,
            name: player.name,
            alive: player.alive
        })),
        [
            { id: "P3", name: "Three", alive: true },
            { id: "P4", name: "Four", alive: true }
        ]
    );
});

test("reset rejects insufficient eligible participants", () => {
    const session = createSession(4);
    session.eliminateParticipant("P1");
    session.eliminateParticipant("P2");
    session.eliminateParticipant("P3");
    const finished = session.reset("P4", 0, 1, [
        { playerId: "P4", displayName: "Four" }
    ]);
    assert.equal(finished.error.code, "INSUFFICIENT_ELIGIBLE_PLAYERS");
});

test("snapshots and event collections are defensive copies", () => {
    const session = createSession();
    const snapshot = session.getSnapshot();
    snapshot.players[0].x = 99;
    snapshot.map[1][1] = 99;
    assert.equal(session.getSnapshot().players[0].x, 1);
    assert.equal(session.getSnapshot().map[1][1], 0);
    session.processAction("P1", { type: "move", direction: "right" }, 0);
    const events = session.getEvents();
    events[0].x = 99;
    assert.equal(session.getEvents()[0].x, 2);
});
