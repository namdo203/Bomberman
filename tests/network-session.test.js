import assert from "node:assert/strict";
import { test } from "node:test";
import { createNetworkSession } from "../js/network-session.js";
import { PROTOCOL_EVENTS } from "../js/protocol.js";

class FakeSocket {
    constructor() {
        this.listeners = new Map();
        this.emitted = [];
    }

    on(eventName, listener) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        this.listeners.get(eventName).add(listener);
        return this;
    }

    off(eventName, listener) {
        this.listeners.get(eventName)?.delete(listener);
        return this;
    }

    emit(eventName, payload) {
        this.emitted.push({ eventName, payload });
        if (this.listeners.has(eventName)) {
            for (const listener of [...this.listeners.get(eventName)]) {
                listener(payload);
            }
        }
        return this;
    }

    trigger(eventName, payload) {
        for (const listener of [...(this.listeners.get(eventName) || [])]) {
            listener(payload);
        }
    }

    listenerCount(eventName) {
        return this.listeners.get(eventName)?.size || 0;
    }
}

function snapshot(overrides = {}) {
    return {
        roomId: "ROOM01",
        gameRevision: 0,
        gameEpoch: 1,
        status: "playing",
        result: null,
        players: [],
        bombs: [],
        explosions: [],
        map: [],
        ...overrides
    };
}

test("registers and removes only its own Socket.IO listeners", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);

    for (const eventName of Object.values(PROTOCOL_EVENTS.responses)) {
        assert.equal(socket.listenerCount(eventName) >= 1, true);
    }

    session.disconnect();
    for (const eventName of Object.values(PROTOCOL_EVENTS.responses)) {
        assert.equal(socket.listenerCount(eventName), 0);
    }
    assert.equal(session.getState(), null);
    assert.equal(session.getRoom(), null);
    assert.equal(session.getPlayerId(), null);
    assert.equal(socket.emitted.length, 0);

    session.disconnect();
});

test("create and join room emit the existing protocol payloads", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);

    session.createRoom("Creator");
    session.joinRoom("ROOM01", "Joiner");

    assert.deepEqual(socket.emitted, [
        { eventName: "room:create", payload: { displayName: "Creator" } },
        { eventName: "room:join", payload: { roomId: "ROOM01", displayName: "Joiner" } }
    ]);
});

test("start, leave, and reset emit protocol requests", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1", status: "waiting" });
    socket.trigger("game:started", snapshot({ gameEpoch: 1, gameRevision: 0 }));

    session.startRoom();
    session.reset();
    session.leave();

    assert.deepEqual(socket.emitted.slice(0, 2), [
        { eventName: "room:start-request", payload: {} },
        { eventName: "game:reset-request", payload: { sequence: 0, gameEpoch: 1 } }
    ]);
    assert.deepEqual(socket.emitted[2], {
        eventName: "room:leave",
        payload: {}
    });
});

test("translates all movement directions and bomb placement", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    socket.trigger("game:started", snapshot({ gameEpoch: 1, gameRevision: 0 }));

    session.dispatch({ dx: 0, dy: -1 });
    session.dispatch({ dx: 0, dy: 1 });
    session.dispatch({ dx: -1, dy: 0 });
    session.dispatch({ dx: 1, dy: 0 });
    session.dispatch({ type: "place-bomb" });

    assert.deepEqual(socket.emitted.map(item => item.payload.action), [
        { type: "move", direction: "up" },
        { type: "move", direction: "down" },
        { type: "move", direction: "left" },
        { type: "move", direction: "right" },
        { type: "place-bomb" }
    ]);
});

test("dispatches protocol direction actions without coordinates", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1", status: "playing" });
    socket.trigger("game:started", snapshot({ gameEpoch: 1, gameRevision: 0 }));

    session.dispatch({ type: "move", direction: "up" });
    session.dispatch({ type: "move", direction: "right" });
    session.dispatch({ type: "place-bomb" });

    assert.deepEqual(socket.emitted.map(item => item.payload.action), [
        { type: "move", direction: "up" },
        { type: "move", direction: "right" },
        { type: "place-bomb" }
    ]);
});

test("sequence numbers remain monotonic across actions and reset", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("game:started", snapshot({ gameEpoch: 1, gameRevision: 0 }));

    session.dispatch({ dx: 1, dy: 0 });
    session.dispatch({ type: "place-bomb" });
    session.reset();
    session.dispatch({ dx: 0, dy: -1 });

    assert.deepEqual(
        socket.emitted
            .filter(item => item.eventName === "game:action")
            .map(item => item.payload.sequence),
        [0, 1, 3]
    );
    assert.equal(socket.emitted[2].payload.sequence, 2);
});

test("game requests attach the current epoch", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);

    socket.trigger("game:started", snapshot({ gameEpoch: 3, gameRevision: 0 }));
    session.dispatch({ dx: 1, dy: 0 });
    session.reset();

    assert.equal(socket.emitted[0].payload.gameEpoch, 3);
    assert.equal(socket.emitted[1].payload.gameEpoch, 3);
});

test("accepts authoritative snapshots and reports state changes", () => {
    const socket = new FakeSocket();
    const states = [];
    const session = createNetworkSession({
        socket,
        onStateChange(state) {
            states.push(state);
        }
    });

    const first = snapshot({ roomId: "ROOM01", players: [{ id: "P1", alive: true }] });
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    socket.trigger("game:started", first);

    assert.deepEqual(session.getState().players, first.players);
    assert.equal(states.length, 1);
    first.players[0].alive = false;
    assert.equal(session.getState().players[0].alive, true);
});

test("does not execute local game transitions", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    const authoritative = snapshot({
        players: [{ id: "P1", x: 1, y: 1, alive: true }],
        map: [[0, 0], [0, 0]]
    });

    socket.trigger("game:updated", authoritative);
    session.dispatch({ dx: 1, dy: 0 });

    assert.deepEqual(session.getState().players, authoritative.players);
    assert.deepEqual(session.getState().map, authoritative.map);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].payload.action.direction, "right");
});

test("filters older revisions in the same epoch and snapshots from another room", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });

    socket.trigger("game:updated", snapshot({ gameRevision: 5, status: "playing" }));
    socket.trigger("game:updated", snapshot({ gameRevision: 4, status: "finished" }));
    socket.trigger("game:updated", snapshot({ roomId: "ROOM02", gameRevision: 6, status: "finished" }));

    assert.equal(session.getState().gameRevision, 5);
    assert.equal(session.getState().status, "playing");
});

test("handles epoch transitions and rejects older epochs", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });

    socket.trigger("game:updated", snapshot({ gameEpoch: 2, gameRevision: 8 }));
    socket.trigger("game:updated", snapshot({ gameEpoch: 1, gameRevision: 20 }));
    socket.trigger("game:updated", snapshot({ gameEpoch: 3, gameRevision: 2, status: "finished" }));

    assert.equal(session.getState().gameEpoch, 3);
    assert.equal(session.getState().gameRevision, 2);
    assert.equal(session.getState().status, "finished");
    assert.equal(session.getState().roomId, "ROOM01");
});

test("exposes room changes, event callbacks, and request errors", () => {
    const socket = new FakeSocket();
    const roomChanges = [];
    const events = [];
    const errors = [];
    const session = createNetworkSession({
        socket,
        onRoomChange(room) {
            roomChanges.push(room);
        },
        onEvent(event) {
            events.push(event);
        },
        onRequestError(error) {
            errors.push(error);
        }
    });

    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    socket.trigger("player:joined", { roomId: "ROOM01", player: { playerId: "P2" } });
    socket.trigger("request:rejected", {
        requestEvent: "room:start-request",
        error: { code: "ROOM_NOT_READY" }
    });

    assert.equal(roomChanges.length, 1);
    assert.equal(session.getPlayerId(), "P1");
    assert.equal(errors[0].error.code, "ROOM_NOT_READY");
    assert.equal(events.length, 3);
});

test("dispatch and reset before a snapshot are locally rejected without sequences", () => {
    const socket = new FakeSocket();
    const errors = [];
    const session = createNetworkSession({
        socket,
        onRequestError(error) {
            errors.push(error);
        }
    });

    session.dispatch({ dx: 1, dy: 0 });
    session.reset();
    session.dispatch({ type: "place-bomb" });

    assert.equal(socket.emitted.length, 0);
    assert.equal(errors.length, 3);
    assert.equal(errors.every(error => error.error.code === "INVALID_GAME_EPOCH"), true);
});

test("invalid local actions do not consume sequence numbers", () => {
    const socket = new FakeSocket();
    const session = createNetworkSession(socket);
    socket.trigger("game:started", snapshot({ gameEpoch: 1, gameRevision: 0 }));

    session.dispatch({ dx: 2, dy: 0 });
    session.dispatch({ type: "unknown" });
    session.dispatch({ dx: 0, dy: 0 });

    assert.equal(socket.emitted.length, 0);
    session.dispatch({ dx: 1, dy: 0 });
    assert.equal(socket.emitted[0].payload.sequence, 0);
});

test("equal revisions are ignored without callbacks", () => {
    const socket = new FakeSocket();
    let stateUpdates = 0;
    let eventUpdates = 0;
    const session = createNetworkSession({
        socket,
        onStateChange() {
            stateUpdates += 1;
        },
        onEvent() {
            eventUpdates += 1;
        }
    });

    socket.trigger("game:updated", snapshot({ gameEpoch: 1, gameRevision: 4 }));
    socket.trigger("game:updated", snapshot({ gameEpoch: 1, gameRevision: 4 }));

    assert.equal(stateUpdates, 1);
    assert.equal(session.getState().gameRevision, 4);
    assert.equal(eventUpdates, 1);
});

test("duplicate updated and finished snapshots do not duplicate updates", () => {
    const socket = new FakeSocket();
    let stateUpdates = 0;
    const session = createNetworkSession({
        socket,
        onStateChange() {
            stateUpdates += 1;
        }
    });

    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    const finished = snapshot({ gameEpoch: 2, gameRevision: 7, status: "finished" });
    socket.trigger("game:updated", finished);
    socket.trigger("game:finished", finished);

    assert.equal(stateUpdates, 1);
    assert.equal(session.getState().gameRevision, 7);
});

test("joining another room clears the previous game and epoch", () => {
    const socket = new FakeSocket();
    const stateUpdates = [];
    const session = createNetworkSession({
        socket,
        onStateChange(state) {
            stateUpdates.push(state);
        }
    });

    socket.trigger("room:joined", { roomId: "ROOM01", playerId: "P1" });
    socket.trigger("game:started", snapshot({ gameEpoch: 4, gameRevision: 9 }));
    socket.trigger("room:joined", { roomId: "ROOM02", playerId: "P2" });

    assert.equal(session.getState(), null);
    assert.equal(session.getRoom().roomId, "ROOM02");
    assert.equal(session.getPlayerId(), "P2");
    assert.equal(stateUpdates.at(-1), null);

    socket.trigger("game:updated", snapshot({
        roomId: "ROOM02",
        gameEpoch: 5,
        gameRevision: 1
    }));
    assert.equal(session.getState().gameEpoch, 5);
    assert.equal(session.getState().gameRevision, 1);
});

test("cleanup preserves unrelated listeners on a shared socket", () => {
    const socket = new FakeSocket();
    const unrelated = () => {};
    socket.on("custom:event", unrelated);

    const session = createNetworkSession(socket);
    session.disconnect();

    assert.equal(socket.listenerCount("custom:event"), 1);
    assert.equal(socket.listenerCount(PROTOCOL_EVENTS.responses.gameUpdated), 0);
});

test("leave preserves room state until acknowledgement succeeds", () => {
    const socket = new FakeSocket();
    socket.emit = function (eventName, payload, acknowledge) {
        this.emitted.push({ eventName, payload });
        if (eventName === "room:leave" && typeof acknowledge === "function") {
            acknowledge({ ok: true });
        }
        return this;
    };
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", {
        roomId: "ROOM01",
        playerId: "P1",
        status: "playing"
    });

    let result = null;
    session.leave(acknowledgment => {
        result = acknowledgment;
    });

    assert.equal(result.ok, true);
    assert.equal(session.getRoom(), null);
});

test("leave failure preserves room and epoch state", () => {
    const socket = new FakeSocket();
    socket.emit = function (eventName, payload, acknowledge) {
        this.emitted.push({ eventName, payload });
        if (eventName === "room:leave" && typeof acknowledge === "function") {
            acknowledge({ ok: false, error: { message: "Leave failed." } });
        }
        return this;
    };
    const session = createNetworkSession(socket);
    socket.trigger("room:joined", {
        roomId: "ROOM01",
        playerId: "P1",
        status: "playing"
    });
    socket.trigger("game:started", snapshot({ gameEpoch: 3, gameRevision: 4 }));

    let result = null;
    session.leave(acknowledgment => {
        result = acknowledgment;
    });

    assert.equal(result.ok, false);
    assert.equal(session.getRoom().roomId, "ROOM01");
    assert.equal(session.getState().gameEpoch, 3);
});
