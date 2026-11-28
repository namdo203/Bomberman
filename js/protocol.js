export const PROTOCOL_EVENTS = Object.freeze({
    requests: Object.freeze({
        createRoom: "room:create",
        joinRoom: "room:join",
        startRoom: "room:start-request",
        leaveRoom: "room:leave",
        gameAction: "game:action",
        resetGame: "game:reset-request"
    }),
    responses: Object.freeze({
        roomJoined: "room:joined",
        roomUpdated: "room:updated",
        playerJoined: "player:joined",
        playerLeft: "player:left",
        gameStarted: "game:started",
        gameUpdated: "game:updated",
        gameFinished: "game:finished",
        rejection: "request:rejected"
    })
});

export const PROTOCOL_ERROR_CODES = Object.freeze({
    INVALID_PAYLOAD: "INVALID_PAYLOAD",
    INVALID_DISPLAY_NAME: "INVALID_DISPLAY_NAME",
    INVALID_ROOM_ID: "INVALID_ROOM_ID",
    INVALID_SEQUENCE: "INVALID_SEQUENCE",
    INVALID_GAME_EPOCH: "INVALID_GAME_EPOCH",
    INVALID_ACTION: "INVALID_ACTION",
    INVALID_DIRECTION: "INVALID_DIRECTION",
    UNEXPECTED_FIELD: "UNEXPECTED_FIELD",
    ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
    ROOM_FULL: "ROOM_FULL",
    ROOM_ALREADY_STARTED: "ROOM_ALREADY_STARTED",
    NOT_IN_ROOM: "NOT_IN_ROOM",
    ALREADY_IN_ROOM: "ALREADY_IN_ROOM",
    ROOM_NOT_READY: "ROOM_NOT_READY",
    INVALID_ROOM_STATE: "INVALID_ROOM_STATE",
    MISSING_MEMBERSHIP_KEY: "MISSING_MEMBERSHIP_KEY",
    PLAYER_ID_GENERATION_FAILED: "PLAYER_ID_GENERATION_FAILED"
});

const DIRECTIONS = new Set(["up", "down", "left", "right"]);
const REQUEST_EVENTS = new Set(Object.values(PROTOCOL_EVENTS.requests));
const REQUEST_FIELDS = Object.freeze({
    [PROTOCOL_EVENTS.requests.createRoom]: new Set(["displayName"]),
    [PROTOCOL_EVENTS.requests.joinRoom]: new Set(["roomId", "displayName"]),
    [PROTOCOL_EVENTS.requests.startRoom]: new Set(),
    [PROTOCOL_EVENTS.requests.leaveRoom]: new Set(),
    [PROTOCOL_EVENTS.requests.gameAction]: new Set(["sequence", "gameEpoch", "action"]),
    [PROTOCOL_EVENTS.requests.resetGame]: new Set(["sequence", "gameEpoch"])
});

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function error(code, field, message) {
    return {
        ok: false,
        error: {
            code,
            field,
            message
        }
    };
}

function success(value) {
    return { ok: true, value };
}

function validateFields(eventName, payload) {
    const allowedFields = REQUEST_FIELDS[eventName];
    for (const field of Object.keys(payload)) {
        if (!allowedFields.has(field)) {
            return error(
                PROTOCOL_ERROR_CODES.UNEXPECTED_FIELD,
                field,
                `Unexpected field "${field}".`
            );
        }
    }
    return null;
}

function validateDisplayName(payload) {
    if (typeof payload.displayName !== "string") {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_DISPLAY_NAME,
            "displayName",
            "Display name must be a string."
        );
    }

    const displayName = payload.displayName.trim();
    if (displayName.length < 2 || displayName.length > 16) {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_DISPLAY_NAME,
            "displayName",
            "Display name must contain 2 to 16 characters."
        );
    }

    return success({ displayName });
}

function validateSequence(payload) {
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0) {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_SEQUENCE,
            "sequence",
            "Sequence must be a non-negative safe integer."
        );
    }

    return success({ sequence: payload.sequence });
}

function validateGameEpoch(payload) {
    if (!Number.isSafeInteger(payload.gameEpoch) || payload.gameEpoch < 1) {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_GAME_EPOCH,
            "gameEpoch",
            "Game epoch must be a positive safe integer."
        );
    }

    return success({ gameEpoch: payload.gameEpoch });
}

function validateRoomId(payload) {
    if (typeof payload.roomId !== "string") {
        return error(PROTOCOL_ERROR_CODES.INVALID_ROOM_ID, "roomId", "Room ID must be a string.");
    }

    const roomId = payload.roomId.trim();
    if (!/^[A-Z0-9]{6}$/.test(roomId)) {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_ROOM_ID,
            "roomId",
            "Room ID must contain exactly 6 uppercase letters or numbers."
        );
    }

    return success({ roomId });
}

function validateAction(payload) {
    if (!isRecord(payload.action) || typeof payload.action.type !== "string") {
        return error(PROTOCOL_ERROR_CODES.INVALID_ACTION, "action", "Action must have a type.");
    }

    if (payload.action.type === "place-bomb") {
        return success({ action: { type: "place-bomb" } });
    }

    if (payload.action.type === "move" && DIRECTIONS.has(payload.action.direction)) {
        return success({
            action: {
                type: "move",
                direction: payload.action.direction
            }
        });
    }

    if (payload.action.type === "move") {
        return error(
            PROTOCOL_ERROR_CODES.INVALID_DIRECTION,
            "action.direction",
            "Movement direction is invalid."
        );
    }

    return error(PROTOCOL_ERROR_CODES.INVALID_ACTION, "action.type", "Action type is invalid.");
}

export function validateRequest(eventName, payload) {
    if (!REQUEST_EVENTS.has(eventName) || !isRecord(payload)) {
        return error(PROTOCOL_ERROR_CODES.INVALID_PAYLOAD, undefined, "Payload must be an object.");
    }

    const fieldResult = validateFields(eventName, payload);
    if (fieldResult) {
        return fieldResult;
    }

    if (eventName === PROTOCOL_EVENTS.requests.createRoom) {
        return validateDisplayName(payload);
    }

    if (eventName === PROTOCOL_EVENTS.requests.joinRoom) {
        const roomResult = validateRoomId(payload);
        if (!roomResult.ok) {
            return roomResult;
        }
        const nameResult = validateDisplayName(payload);
        if (!nameResult.ok) {
            return nameResult;
        }
        return success({ ...roomResult.value, ...nameResult.value });
    }

    if (eventName === PROTOCOL_EVENTS.requests.resetGame) {
        const sequenceResult = validateSequence(payload);
        if (!sequenceResult.ok) {
            return sequenceResult;
        }
        const epochResult = validateGameEpoch(payload);
        if (!epochResult.ok) {
            return epochResult;
        }
        return success({ ...sequenceResult.value, ...epochResult.value });
    }

    if (eventName === PROTOCOL_EVENTS.requests.startRoom
        || eventName === PROTOCOL_EVENTS.requests.leaveRoom) {
        return success({});
    }

    const sequenceResult = validateSequence(payload);
    if (!sequenceResult.ok) {
        return sequenceResult;
    }
    const epochResult = validateGameEpoch(payload);
    if (!epochResult.ok) {
        return epochResult;
    }
    const actionResult = validateAction(payload);
    if (!actionResult.ok) {
        return actionResult;
    }
    return success({
        ...sequenceResult.value,
        ...epochResult.value,
        ...actionResult.value
    });
}

export function createRejection(eventName, validationError) {
    return {
        requestEvent: eventName,
        error: validationError.error
    };
}
