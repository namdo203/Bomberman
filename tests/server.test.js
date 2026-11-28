import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
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
    await new Promise((resolve) => testServer.app.server.close(resolve));
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
    return new Promise((resolve) => {
        client.emit(eventName, payload, resolve);
    });
}

function waitForEvent(client, eventName, timeoutMs = 500) {
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

test("development server serves the application over HTTP", async () => {
    const port = 8090;
    const server = spawn(process.execPath, ["server/dev-server.js"], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
    });

    try {
        await once(server.stdout, "data");
        const response = await fetch(`http://localhost:${port}/`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /<script type="module" src="js\/main\.js"><\/script>/);

        const missing = await fetch(`http://localhost:${port}/missing-file.js`);
        assert.equal(missing.status, 404);
    } finally {
        server.kill();
    }
});

test("Socket.IO room lifecycle supports create, join, leave, and duplicate protection", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const creator = await connectClient(testServer.url);
        const joiner = await connectClient(testServer.url);
        clients.push(creator, joiner);

        const createdPayloadWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomJoined);
        const created = await emitWithAck(
            creator,
            PROTOCOL_EVENTS.requests.createRoom,
            { displayName: "Creator" }
        );
        const createdPayload = await createdPayloadWait;
        assert.equal(created.ok, true);
        assert.match(createdPayload.roomId, /^[A-Z0-9]{6}$/);

        const playerJoined = waitForEvent(creator, PROTOCOL_EVENTS.responses.playerJoined);
        const joinUpdated = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomUpdated);
        const joinPayloadWait = waitForEvent(joiner, PROTOCOL_EVENTS.responses.roomJoined);
        const joined = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId: createdPayload.roomId,
            displayName: "Joiner"
        });
        assert.equal(joined.ok, true);
        await joinPayloadWait;
        assert.equal((await playerJoined).player.displayName, "Joiner");
        assert.equal((await joinUpdated).players.length, 2);

        const repeatedCreate = await emitWithAck(
            creator,
            PROTOCOL_EVENTS.requests.createRoom,
            { displayName: "Another" }
        );
        assert.equal(repeatedCreate.error.code, "ALREADY_IN_ROOM");

        const repeatedJoin = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId: createdPayload.roomId,
            displayName: "Again"
        });
        assert.equal(repeatedJoin.error.code, "ALREADY_IN_ROOM");

        const leaveUpdated = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomUpdated);
        let joinerOldRoomBroadcasts = 0;
        joiner.on(PROTOCOL_EVENTS.responses.playerLeft, () => {
            joinerOldRoomBroadcasts += 1;
        });
        joiner.on(PROTOCOL_EVENTS.responses.roomUpdated, () => {
            joinerOldRoomBroadcasts += 1;
        });
        const left = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.leaveRoom);
        assert.equal(left.ok, true);
        const snapshot = await leaveUpdated;
        assert.equal(snapshot.players.length, 1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(joinerOldRoomBroadcasts, 0);

        const rejoin = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId: createdPayload.roomId,
            displayName: "Rejoined"
        });
        assert.equal(rejoin.ok, true);

        await emitWithAck(joiner, PROTOCOL_EVENTS.requests.leaveRoom);
        const newRoom = await emitWithAck(joiner, PROTOCOL_EVENTS.requests.createRoom, {
            displayName: "New Room"
        });
        assert.equal(newRoom.ok, true);
    } finally {
        await stopTestServer(testServer, clients);
    }
});

test("playing explicit leave removes broadcast membership and is idempotent", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const creator = await connectClient(testServer.url);
        const leaver = await connectClient(testServer.url);
        clients.push(creator, leaver);

        const creatorJoinedWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(creator, PROTOCOL_EVENTS.requests.createRoom, { displayName: "Creator" });
        const joinedPayload = await creatorJoinedWait;
        const roomId = joinedPayload.roomId;

        const leaverJoinedWait = waitForEvent(leaver, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(leaver, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId,
            displayName: "Leaver"
        });
        await leaverJoinedWait;
        await emitWithAck(creator, PROTOCOL_EVENTS.requests.startRoom);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const remainingUpdated = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomUpdated);
        let eliminatedBroadcasts = 0;
        leaver.on(PROTOCOL_EVENTS.responses.roomUpdated, () => {
            eliminatedBroadcasts += 1;
        });
        leaver.on(PROTOCOL_EVENTS.responses.playerLeft, () => {
            eliminatedBroadcasts += 1;
        });

        const leave = await emitWithAck(leaver, PROTOCOL_EVENTS.requests.leaveRoom);
        assert.equal(leave.ok, true);
        const remainingSnapshot = await remainingUpdated;
        assert.equal(remainingSnapshot.players.find(player => player.displayName === "Leaver")?.status, "eliminated");
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(eliminatedBroadcasts, 0);

        const snapshot = testServer.app.roomManager.getRoomSnapshot(roomId);
        const eliminated = snapshot.players.find((player) => player.displayName === "Leaver");
        assert.equal(eliminated.status, "eliminated");
        assert.equal(eliminated.leaveReason, "left");

        const startRejected = await emitWithAck(leaver, PROTOCOL_EVENTS.requests.startRoom);
        assert.equal(startRejected.error.code, "NOT_IN_ROOM");
        const repeatedLeave = await emitWithAck(leaver, PROTOCOL_EVENTS.requests.leaveRoom);
        assert.equal(repeatedLeave.error.code, "NOT_IN_ROOM");
        const createAccepted = await emitWithAck(leaver, PROTOCOL_EVENTS.requests.createRoom, {
            displayName: "Other"
        });
        assert.equal(createAccepted.ok, true);

        const revisionBeforeDisconnect = snapshot.roomRevision;
        leaver.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
            testServer.app.roomManager.getRoomSnapshot(roomId).roomRevision,
            revisionBeforeDisconnect
        );
    } finally {
        await stopTestServer(testServer, clients);
    }
});

test("unexpected disconnect uses waiting removal and playing elimination", async () => {
    const testServer = await startTestServer();
    const clients = [];
    try {
        const creator = await connectClient(testServer.url);
        const waitingJoiner = await connectClient(testServer.url);
        clients.push(creator, waitingJoiner);

        const creatorJoinedWait = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(creator, PROTOCOL_EVENTS.requests.createRoom, { displayName: "Creator" });
        const createdPayload = await creatorJoinedWait;
        const waitingRoomId = createdPayload.roomId;

        const waitingJoinWait = waitForEvent(waitingJoiner, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(waitingJoiner, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId: waitingRoomId,
            displayName: "Waiting"
        });
        await waitingJoinWait;
        await new Promise((resolve) => setTimeout(resolve, 100));

        const waitingUpdate = waitForEvent(creator, PROTOCOL_EVENTS.responses.roomUpdated);
        waitingJoiner.disconnect();
        const waitingSnapshot = await waitingUpdate;
        assert.equal(waitingSnapshot.players.length, 1);
        assert.equal(testServer.app.roomManager.getRoom(waitingRoomId).players.size, 1);

        const playingCreator = await connectClient(testServer.url);
        const playingJoiner = await connectClient(testServer.url);
        clients.push(playingCreator, playingJoiner);

        const playingCreatorWait = waitForEvent(playingCreator, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(playingCreator, PROTOCOL_EVENTS.requests.createRoom, { displayName: "Player1" });
        const playingCreated = await playingCreatorWait;

        const playingJoinWait = waitForEvent(playingJoiner, PROTOCOL_EVENTS.responses.roomJoined);
        await emitWithAck(playingJoiner, PROTOCOL_EVENTS.requests.joinRoom, {
            roomId: playingCreated.roomId,
            displayName: "Player2"
        });
        await playingJoinWait;
        await emitWithAck(playingCreator, PROTOCOL_EVENTS.requests.startRoom);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const revisionBefore = testServer.app.roomManager
            .getRoomSnapshot(playingCreated.roomId).roomRevision;
        const playingUpdate = waitForEvent(playingCreator, PROTOCOL_EVENTS.responses.roomUpdated);
        playingJoiner.disconnect();
        const playingSnapshot = await playingUpdate;
        const eliminated = playingSnapshot.players.find((player) => player.displayName === "Player2");
        assert.equal(eliminated.status, "eliminated");
        assert.equal(eliminated.leaveReason, "disconnected");
        assert.equal(
            testServer.app.roomManager.getRoomSnapshot(playingCreated.roomId).roomRevision,
            revisionBefore + 1
        );
    } finally {
        await stopTestServer(testServer, clients);
    }
});
