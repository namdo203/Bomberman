import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { io as createClient } from "socket.io-client";
import { createDevelopmentServer } from "../server/dev-server.js";
import { PROTOCOL_EVENTS } from "../js/protocol.js";

async function startTestServer() {
    const app = createDevelopmentServer();
    await new Promise((resolve, reject) => {
        app.server.once("error", reject);
        app.server.listen(0, "127.0.0.1", resolve);
    });
    const address = app.server.address();
    return { app, url: `http://127.0.0.1:${address.port}` };
}

async function stopTestServer(testServer, clients) {
    for (const client of clients) {
        client.disconnect();
    }
    testServer.app.io.close();
    await new Promise(resolve => testServer.app.server.close(resolve));
}

function connectClient(url) {
    return new Promise((resolve, reject) => {
        const client = createClient(url, {
            transports: ["websocket"],
            forceNew: true,
            reconnection: false
        });
        client.once("connect", () => resolve(client));
        client.once("connect_error", reject);
    });
}

function emitWithAck(client, eventName, payload = {}) {
    return new Promise(resolve => client.emit(eventName, payload, resolve));
}

function waitForEvent(client, eventName, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            client.off(eventName, handler);
            reject(new Error(`Timed out waiting for ${eventName}`));
        }, timeoutMs);
        function handler(payload) {
            clearTimeout(timer);
            resolve(payload);
        }
        client.once(eventName, handler);
    });
}

function waitForNoEvent(client, eventName, timeoutMs = 150) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, timeoutMs);
        client.once(eventName, () => {
            clearTimeout(timer);
            reject(new Error(`Unexpected ${eventName} event.`));
        });
    });
}

async function createStartedRoom(testServer, clients, names = ["Creator", "Joiner"]) {
    const creator = await connectClient(testServer.url);
    const joiner = await connectClient(testServer.url);
    clients.push(creator, joiner);

    const joinedWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomJoined);
    await emitWithAck(creator, PROTOCOL_EVENTS.requests.createRoom, {
        displayName: names[0]
    });
    const roomJoined = await joinedWait;

    const joinWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.roomJoined);
    await emitWithAck(joiner, PROTOCOL_EVENTS.requests.joinRoom, {
        roomId: roomJoined.roomId,
        displayName: names[1]
    });
    await joinWait;

    const startedWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.gameStarted);
    const started = await emitWithAck(creator, PROTOCOL_EVENTS.requests.startRoom);
    assert.equal(started.ok, true);
    const gameStarted = await startedWait;
    return { creator, joiner, roomId: roomJoined.roomId, gameStarted };
}

test("playing rooms create one independent GameSession after a valid start", async () => {
    const testServer = await startTestServer();
    const clients = [];
    let sessions = [];
    try {
        const first = await createStartedRoom(testServer, clients);
        assert.equal(testServer.app.gameSessions.size, 1);
        const firstSession = testServer.app.gameSessions.get(first.roomId);
        assert.ok(firstSession);
        const repeatedStart = await emitWithAck(
            first.creator,
            PROTOCOL_EVENTS.requests.startRoom
        );
        assert.equal(repeatedStart.error.code, "ROOM_ALREADY_STARTED");
        assert.strictEqual(testServer.app.gameSessions.get(first.roomId), firstSession);

        const second = await createStartedRoom(testServer, clients, ["Other1", "Other2"]);
        assert.equal(testServer.app.gameSessions.size, 2);
        assert.notStrictEqual(
            testServer.app.gameSessions.get(first.roomId),
            testServer.app.gameSessions.get(second.roomId)
        );
        sessions = [...testServer.app.gameSessions.values()];
    } finally {
        await stopTestServer(testServer, clients);
    }
    assert.equal(sessions.every(session => session.disposed), true);
});

test("game actions use socket identity and broadcast only changed authoritative snapshots", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const { creator, joiner, gameStarted } = await createStartedRoom(testServer, clients);
        const creatorId = gameStarted.players[0].id;
        const movedWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameUpdated);
        const moved = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 0,
            gameEpoch: gameStarted.gameEpoch,
            action: { type: "move", direction: "right" }
        });
        assert.deepEqual(moved, { ok: true, changed: true, gameEpoch: 1 });
        const movedSnapshot = await movedWait;
        assert.equal(movedSnapshot.players.find(player => player.id === creatorId).x, 2);
        assert.equal(movedSnapshot.gameRevision, 1);

        const forged = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 1,
            gameEpoch: gameStarted.gameEpoch,
            playerId: gameStarted.players[1].id,
            action: { type: "move", direction: "right" }
        });
        assert.equal(forged.error.code, "UNEXPECTED_FIELD");

        const stale = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 0,
            gameEpoch: gameStarted.gameEpoch,
            action: { type: "move", direction: "right" }
        });
        assert.equal(stale.error.code, "INVALID_SEQUENCE");

        const noOp = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 1,
            gameEpoch: gameStarted.gameEpoch,
            action: { type: "move", direction: "up" }
        });
        assert.deepEqual(noOp, { ok: true, changed: false, gameEpoch: 1 });
        await waitForNoEvent(joiner, PROTOCOL_EVENTS.responses.gameUpdated);
    } finally {
        await stopTestServer(testServer, clients);
    }
});

test("bomb completion, reset, and disconnect elimination stay room-scoped", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const { creator, joiner, roomId } = await createStartedRoom(testServer, clients);
        const bombUpdate = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameUpdated);
        const bomb = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 0,
            gameEpoch: 1,
            action: { type: "place-bomb" }
        });
        assert.deepEqual(bomb, { ok: true, changed: true, gameEpoch: 1 });
        assert.equal((await bombUpdate).bombs.length, 1);

        const finishedWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameFinished, 4500);
        const finishedUpdate = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameUpdated, 4500);
        const finished = await finishedWait;
        const update = await finishedUpdate;
        assert.equal(finished.status, "finished");
        assert.deepEqual(finished.result, { type: "win", winnerId: update.players[1].id });

        const joinerResetWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameUpdated);
        const creatorResetWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.gameUpdated);
        const reset = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.resetGame, {
            sequence: 0,
            gameEpoch: 1
        });
        assert.deepEqual(reset, { ok: true, changed: true, gameEpoch: 2 });
        const resetSnapshot = await joinerResetWait;
        const creatorResetSnapshot = await creatorResetWait;
        assert.equal(resetSnapshot.status, "playing");
        assert.equal(resetSnapshot.gameEpoch, 2);
        assert.deepEqual(creatorResetSnapshot, resetSnapshot);
        assert.deepEqual(resetSnapshot.players.map(player => [player.id, player.x, player.y]), [
            [finished.players[0].id, 1, 1],
            [finished.players[1].id, 13, 1]
        ]);

        const staleAction = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 1,
            gameEpoch: 1,
            action: { type: "move", direction: "right" }
        });
        assert.equal(staleAction.error.code, "INVALID_GAME_EPOCH");

        const currentAction = await emitWithAck(creator, PROTOCOL_EVENTS.requests.gameAction, {
            sequence: 1,
            gameEpoch: 2,
            action: { type: "move", direction: "right" }
        });
        assert.deepEqual(currentAction, { ok: true, changed: true, gameEpoch: 2 });

        const staleReset = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.resetGame, {
            sequence: 1,
            gameEpoch: 1
        });
        assert.equal(staleReset.error.code, "INVALID_GAME_EPOCH");

        const repeatedReset = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.resetGame, {
            sequence: 1,
            gameEpoch: 2
        });
        assert.equal(repeatedReset.error.code, "INVALID_ROOM_STATE");

        const eliminationWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.gameFinished);
        creator.disconnect();
        const eliminated = await eliminationWait;
        assert.deepEqual(eliminated.result, {
            type: "win",
            winnerId: eliminated.players[1].id
        });
        assert.equal(
            testServer.app.roomManager.getRoomSnapshot(roomId).players[0].status,
            "eliminated"
        );
    } finally {
        await stopTestServer(testServer, clients);
    }
});

test("rejected starts do not allocate sessions and shutdown disposes active sessions", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const creator = await connectClient(testServer.url);
        clients.push(creator);
        const roomJoinedWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(creator, PROTOCOL_EVENTS.requests.createRoom, {
            displayName: "Solo"
        });
        await roomJoinedWait;
        const rejected = await emitWithAck(creator, PROTOCOL_EVENTS.requests.startRoom);
        assert.equal(rejected.error.code, "ROOM_NOT_READY");
        assert.equal(testServer.app.gameSessions.size, 0);
    } finally {
        await stopTestServer(testServer, clients);
    }
});
