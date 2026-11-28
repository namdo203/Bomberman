import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomManager } from "../server/room-manager.js";

function createManager(roomIds = [], playerIds = []) {
    let roomIndex = 0;
    let playerIndex = 0;
    return new RoomManager({
        roomIdGenerator: () => roomIds[roomIndex++] || `AB${String(roomIndex).padStart(4, "0")}`,
        playerIdGenerator: () => playerIds[playerIndex++] || `P${playerIndex}`
    });
}

test("room creation generates a six-character ID and joins the creator", () => {
    const manager = new RoomManager();
    const created = manager.createRoom("  Namdo  ", "socket-1");
    assert.equal(created.ok, true);
    assert.match(created.room.id, /^[A-Z0-9]{6}$/);
    assert.equal(created.room.status, "waiting");
    assert.equal(created.room.roomRevision, 1);
    assert.equal(created.room.players.size, 1);
    assert.equal(created.player.displayName, "Namdo");
});

test("room ID collisions are retried safely", () => {
    const manager = createManager(["ABC123", "ABC123", "XYZ789"]);
    const first = manager.createRoom("One", "socket-1");
    const second = manager.createRoom("Two", "socket-2");
    assert.equal(first.room.id, "ABC123");
    assert.equal(second.room.id, "XYZ789");
});

test("joining, capacity, duplicate membership, and invalid IDs are enforced", () => {
    const manager = createManager(["ROOM01"]);
    const created = manager.createRoom("One", "socket-1");

    assert.equal(manager.joinRoom("missing", "Two", "socket-2").error.code, "INVALID_ROOM_ID");
    assert.equal(manager.joinRoom("ROOM02", "Two", "socket-2").error.code, "ROOM_NOT_FOUND");
    assert.equal(manager.joinRoom(created.room.id, "Two", "socket-1").error.code, "ALREADY_IN_ROOM");

    for (const [name, socket] of [["Two", "socket-2"], ["Three", "socket-3"], ["Four", "socket-4"]]) {
        assert.equal(manager.joinRoom(created.room.id, name, socket).ok, true);
    }
    const full = manager.joinRoom(created.room.id, "Five", "socket-5");
    assert.equal(full.error.code, "ROOM_FULL");
});

test("rooms require at least two connected players before starting", () => {
    const manager = createManager(["START1"]);
    const created = manager.createRoom("One", "socket-1");
    assert.equal(manager.startRoom(created.room.id, created.player.id).error.code, "ROOM_NOT_READY");

    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    assert.equal(manager.startRoom(created.room.id, created.player.id).ok, true);
    assert.equal(joined.room.status, "playing");
    assert.equal(joined.room.roomRevision, 3);

    assert.equal(manager.joinRoom(created.room.id, "Three", "socket-3").error.code, "ROOM_ALREADY_STARTED");
    assert.equal(manager.startRoom(created.room.id, created.player.id).error.code, "ROOM_ALREADY_STARTED");
});

test("waiting leaves remove players and delete an empty room", () => {
    const manager = createManager(["LEAVE1"]);
    const created = manager.createRoom("One", "socket-1");
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");

    const left = manager.leaveRoom(created.room.id, joined.player.id);
    assert.equal(left.removed, true);
    assert.equal(created.room.players.size, 1);
    assert.equal(manager.getRoom(created.room.id), created.room);

    const deleted = manager.leaveRoom(created.room.id, created.player.id);
    assert.equal(deleted.deleted, true);
    assert.equal(manager.getRoom(created.room.id), null);
});

test("playing leaves eliminate players and retain their records", () => {
    const manager = createManager(["PLAY01"]);
    const created = manager.createRoom("One", "socket-1");
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    manager.startRoom(created.room.id, created.player.id);

    const left = manager.leaveRoom(created.room.id, joined.player.id);
    assert.equal(left.removed, false);
    assert.equal(left.eliminated, true);
    assert.equal(created.room.players.has(joined.player.id), true);
    assert.equal(created.room.players.get(joined.player.id).status, "eliminated");

    const duplicate = manager.leaveRoom(created.room.id, joined.player.id);
    assert.equal(duplicate.alreadyHandled, true);
    assert.equal(duplicate.changed, false);
    assert.equal(manager.isMembershipKeyInRoom("socket-2"), false);
    assert.equal(manager.getPlayerRoom(joined.player.id), null);
});

test("room revisions increase only for membership or status changes", () => {
    const manager = createManager(["REV001"]);
    const created = manager.createRoom("One", "socket-1");
    assert.equal(created.room.roomRevision, 1);
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    assert.equal(joined.room.roomRevision, 2);
    manager.startRoom(created.room.id, created.player.id);
    assert.equal(joined.room.roomRevision, 3);
    assert.equal(manager.leaveRoom(created.room.id, joined.player.id).room.roomRevision, 4);
});

test("invalid membership and state transitions are rejected", () => {
    const manager = createManager(["STATE1"]);
    const created = manager.createRoom("One", "socket-1");
    assert.equal(manager.leaveRoom(created.room.id, "not-a-player").error.code, "NOT_IN_ROOM");
    assert.equal(manager.startRoom("NONE99", created.player.id).error.code, "ROOM_NOT_FOUND");

    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    assert.equal(manager.startRoom(created.room.id, joined.player.id).ok, true);
    assert.equal(manager.leaveRoom("NONE99", joined.player.id).error.code, "ROOM_NOT_FOUND");
});

test("membership key is required for room creation and joining", () => {
    const manager = createManager(["KEY001"]);
    assert.equal(manager.createRoom("One").error.code, "MISSING_MEMBERSHIP_KEY");

    const created = manager.createRoom("One", "socket-1");
    assert.equal(
        manager.joinRoom(created.room.id, "Two").error.code,
        "MISSING_MEMBERSHIP_KEY"
    );
});

test("player ID generation stops after repeated duplicate candidates", () => {
    const manager = new RoomManager({
        roomIdGenerator: () => "PLAYER",
        playerIdGenerator: () => "SAMEID"
    });
    const first = manager.createRoom("One", "socket-1");
    assert.equal(first.ok, true);
    const second = manager.joinRoom(first.room.id, "Two", "socket-2");
    assert.equal(second.error.code, "PLAYER_ID_GENERATION_FAILED");
    assert.equal(first.room.players.size, 1);
});

test("snapshots are copies and eliminated players cannot start or join", () => {
    const manager = createManager(["SNAP01"]);
    const created = manager.createRoom("One", "socket-1");
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    manager.startRoom(created.room.id, created.player.id);

    const left = manager.leaveRoom(created.room.id, joined.player.id, "explicit");
    assert.equal(left.reason, "left");
    const snapshot = manager.getRoomSnapshot(created.room.id);
    snapshot.players[0].displayName = "Mutated";
    snapshot.status = "mutated";
    assert.equal(manager.getRoom(created.room.id).status, "playing");
    assert.equal(manager.getRoom(created.room.id).players.get(created.player.id).displayName, "One");

    assert.equal(manager.startRoom(created.room.id, joined.player.id).error.code, "NOT_IN_ROOM");
    assert.equal(
        manager.joinRoom(created.room.id, "Three", "socket-3").error.code,
        "ROOM_ALREADY_STARTED"
    );
});

test("a playing room remains retained after all players disconnect", () => {
    const manager = createManager(["ORPH01"]);
    const created = manager.createRoom("One", "socket-1");
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    manager.startRoom(created.room.id, created.player.id);

    manager.leaveRoom(created.room.id, created.player.id, "disconnected");
    manager.leaveRoom(created.room.id, joined.player.id, "disconnected");

    const orphan = manager.getRoom(created.room.id);
    assert.equal(orphan.status, "playing");
    assert.equal(orphan.players.size, 2);
    assert.equal([...orphan.players.values()].every((player) => player.status === "eliminated"), true);
    assert.equal(manager.getRoomSnapshot(created.room.id).roomId, "ORPH01");
});

test("replay eligibility includes only connected non-eliminated players", () => {
    const manager = createManager(["REPLAY"]);
    const created = manager.createRoom("One", "socket-1");
    const joined = manager.joinRoom(created.room.id, "Two", "socket-2");
    manager.startRoom(created.room.id, created.player.id);

    manager.leaveRoom(created.room.id, joined.player.id, "explicit");

    assert.deepEqual(
        manager.getEligibleReplayParticipants(created.room.id),
        [{ playerId: created.player.id, displayName: "One" }]
    );

    manager.leaveRoom(created.room.id, created.player.id, "disconnected");
    assert.deepEqual(manager.getEligibleReplayParticipants(created.room.id), []);
});
