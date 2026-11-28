import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createRejection,
    PROTOCOL_ERROR_CODES,
    PROTOCOL_EVENTS,
    validateRequest
} from "../js/protocol.js";

const requests = PROTOCOL_EVENTS.requests;

test("request and response event constants match the protocol contract", () => {
    assert.deepEqual(requests, {
        createRoom: "room:create",
        joinRoom: "room:join",
        startRoom: "room:start-request",
        leaveRoom: "room:leave",
        gameAction: "game:action",
        resetGame: "game:reset-request"
    });
    assert.deepEqual(PROTOCOL_EVENTS.responses, {
        roomJoined: "room:joined",
        roomUpdated: "room:updated",
        playerJoined: "player:joined",
        playerLeft: "player:left",
        gameStarted: "game:started",
        gameUpdated: "game:updated",
        gameFinished: "game:finished",
        rejection: "request:rejected"
    });
});

test("valid room payloads are normalized", () => {
    assert.deepEqual(
        validateRequest(requests.createRoom, { displayName: "  Namdo  " }),
        { ok: true, value: { displayName: "Namdo" } }
    );
    assert.deepEqual(
        validateRequest(requests.joinRoom, {
            roomId: "  K7Q4M1 ",
            displayName: " Player "
        }),
        { ok: true, value: { roomId: "K7Q4M1", displayName: "Player" } }
    );
});

test("room IDs must be exactly six uppercase alphanumeric characters", () => {
    for (const roomId of ["ABC12", "ABC1234", "abc123", "ABC-12", "ABC_12"]) {
        const result = validateRequest(requests.joinRoom, {
            roomId,
            displayName: "Player"
        });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, PROTOCOL_ERROR_CODES.INVALID_ROOM_ID);
    }
    assert.equal(
        validateRequest(requests.joinRoom, {
            roomId: "ABC123",
            displayName: "Player"
        }).ok,
        true
    );
});

test("room requests reject missing and invalid required fields", () => {
    const nameResult = validateRequest(requests.createRoom, { displayName: "x" });
    assert.equal(nameResult.ok, false);
    assert.equal(nameResult.error.code, PROTOCOL_ERROR_CODES.INVALID_DISPLAY_NAME);

    const missingName = validateRequest(requests.createRoom, {});
    assert.equal(missingName.error.code, PROTOCOL_ERROR_CODES.INVALID_DISPLAY_NAME);

    const roomResult = validateRequest(requests.joinRoom, {
        roomId: "NOT_VALID!",
        displayName: "Player"
    });
    assert.equal(roomResult.ok, false);
    assert.equal(roomResult.error.code, PROTOCOL_ERROR_CODES.INVALID_ROOM_ID);

    const missingRoomId = validateRequest(requests.joinRoom, { displayName: "Player" });
    assert.equal(missingRoomId.error.code, PROTOCOL_ERROR_CODES.INVALID_ROOM_ID);

    const missingJoinName = validateRequest(requests.joinRoom, { roomId: "K7Q4M1" });
    assert.equal(missingJoinName.error.code, PROTOCOL_ERROR_CODES.INVALID_DISPLAY_NAME);
});

test("start and leave requests do not require sequences", () => {
    assert.deepEqual(validateRequest(requests.startRoom, {}), { ok: true, value: {} });
    assert.deepEqual(validateRequest(requests.leaveRoom, {}), { ok: true, value: {} });
});

test("game actions require valid sequences and approved intent shapes", () => {
    assert.deepEqual(
        validateRequest(requests.gameAction, {
            sequence: 4,
            gameEpoch: 1,
            action: { type: "move", direction: "left" }
        }),
        {
            ok: true,
            value: {
                sequence: 4,
                gameEpoch: 1,
                action: { type: "move", direction: "left" }
            }
        }
    );
    assert.deepEqual(
        validateRequest(requests.gameAction, {
            sequence: 5,
            gameEpoch: 1,
            action: { type: "place-bomb" }
        }),
        {
            ok: true,
            value: { sequence: 5, gameEpoch: 1, action: { type: "place-bomb" } }
        }
    );

    const invalidSequence = validateRequest(requests.gameAction, {
        sequence: -1,
        gameEpoch: 1,
        action: { type: "place-bomb" }
    });
    assert.equal(invalidSequence.error.code, PROTOCOL_ERROR_CODES.INVALID_SEQUENCE);

    const invalidDirection = validateRequest(requests.gameAction, {
        sequence: 6,
        gameEpoch: 1,
        action: { type: "move", direction: "teleport" }
    });
    assert.equal(invalidDirection.error.code, PROTOCOL_ERROR_CODES.INVALID_DIRECTION);
});

test("reset requests require a sequence", () => {
    assert.deepEqual(
        validateRequest(requests.resetGame, { sequence: 3, gameEpoch: 1 }),
        { ok: true, value: { sequence: 3, gameEpoch: 1 } }
    );

    const missingSequence = validateRequest(requests.resetGame, {});
    assert.equal(missingSequence.error.code, PROTOCOL_ERROR_CODES.INVALID_SEQUENCE);
    const missingEpoch = validateRequest(requests.resetGame, { sequence: 3 });
    assert.equal(missingEpoch.error.code, PROTOCOL_ERROR_CODES.INVALID_GAME_EPOCH);
    const invalidEpoch = validateRequest(requests.resetGame, {
        sequence: 3,
        gameEpoch: 0
    });
    assert.equal(invalidEpoch.error.code, PROTOCOL_ERROR_CODES.INVALID_GAME_EPOCH);
});

test("malformed and authoritative-state payloads are rejected safely", () => {
    const malformed = validateRequest(requests.gameAction, null);
    assert.equal(malformed.error.code, PROTOCOL_ERROR_CODES.INVALID_PAYLOAD);

    const forged = validateRequest(requests.gameAction, {
        sequence: 1,
        gameEpoch: 1,
        playerId: 99,
        x: 8,
        y: 8,
        timestamp: Date.now(),
        action: { type: "place-bomb" }
    });
    assert.equal(forged.error.code, PROTOCOL_ERROR_CODES.UNEXPECTED_FIELD);
    assert.equal(forged.error.field, "playerId");
});

test("unexpected fields are rejected for every request type", () => {
    for (const [eventName, payload] of [
        [requests.createRoom, { displayName: "Player", timestamp: 1 }],
        [requests.joinRoom, { roomId: "K7Q4M1", displayName: "Player", playerId: "p1" }],
        [requests.startRoom, { deadline: 1 }],
        [requests.leaveRoom, { playerId: "p1" }],
        [requests.gameAction, {
            sequence: 1,
            gameEpoch: 1,
            action: { type: "place-bomb" },
            x: 1
        }],
        [requests.resetGame, { sequence: 1, gameEpoch: 1, state: {} }]
    ]) {
        const result = validateRequest(eventName, payload);
        assert.equal(result.ok, false);
        assert.equal(result.error.code, PROTOCOL_ERROR_CODES.UNEXPECTED_FIELD);
    }
});

test("rejection payloads have a consistent structure", () => {
    const result = validateRequest(requests.resetGame, { sequence: "1", gameEpoch: 1 });
    assert.deepEqual(createRejection(requests.resetGame, result), {
        requestEvent: "game:reset-request",
        error: {
            code: PROTOCOL_ERROR_CODES.INVALID_SEQUENCE,
            field: "sequence",
            message: "Sequence must be a non-negative safe integer."
        }
    });
});

test("all protocol validation error codes are exercised", () => {
    const results = [
        validateRequest("unknown:event", {}),
        validateRequest(requests.createRoom, {}),
        validateRequest(requests.joinRoom, { roomId: "!", displayName: "Player" }),
        validateRequest(requests.gameAction, {
            sequence: -1,
            gameEpoch: 1,
            action: { type: "place-bomb" }
        }),
        validateRequest(requests.gameAction, {
            sequence: 1,
            gameEpoch: 1,
            action: {}
        }),
        validateRequest(requests.gameAction, {
            sequence: 1,
            gameEpoch: 1,
            action: { type: "move", direction: "teleport" }
        }),
        validateRequest(requests.gameAction, {
            sequence: 1,
            action: { type: "place-bomb" }
        }),
        validateRequest(requests.startRoom, { timestamp: 1 })
    ];
    assert.deepEqual(
        new Set([
            ...results.map((result) => result.error.code),
            "ROOM_NOT_FOUND",
            "ROOM_FULL",
            "ROOM_ALREADY_STARTED",
            "NOT_IN_ROOM",
            "ALREADY_IN_ROOM",
            "ROOM_NOT_READY",
            "INVALID_ROOM_STATE",
            "INVALID_GAME_EPOCH",
            "MISSING_MEMBERSHIP_KEY",
            "PLAYER_ID_GENERATION_FAILED"
        ]),
        new Set(Object.values(PROTOCOL_ERROR_CODES))
    );
});
