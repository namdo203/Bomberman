import { randomUUID } from "node:crypto";

const ROOM_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function error(code, message, field) {
    return {
        ok: false,
        error: {
            code,
            field,
            message
        }
    };
}

function normalizedDisplayName(displayName) {
    if (typeof displayName !== "string") {
        return null;
    }
    const normalized = displayName.trim();
    return normalized.length >= 2 && normalized.length <= 16 ? normalized : null;
}

function copyPlayer(player) {
    return {
        playerId: player.id,
        displayName: player.displayName,
        status: player.status,
        connected: player.connected !== false,
        leaveReason: player.leaveReason || null
    };
}

export class RoomManager {
    constructor(options = {}) {
        this.rooms = new Map();
        this.playerRooms = new Map();
        this.membershipKeys = new Map();
        this.roomIdGenerator = options.roomIdGenerator || this.createRoomId.bind(this);
        this.playerIdGenerator = options.playerIdGenerator
            || (() => `P-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`);
    }

    createRoomId() {
        let result = "";
        for (let index = 0; index < 6; index += 1) {
            result += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
        }
        return result;
    }

    generateUniqueRoomId() {
        for (let attempt = 0; attempt < 10000; attempt += 1) {
            const roomId = String(this.roomIdGenerator()).trim().toUpperCase();
            if (/^[A-Z0-9]{6}$/.test(roomId) && !this.rooms.has(roomId)) {
                return roomId;
            }
        }
        throw new Error("Unable to generate a unique room ID.");
    }

    createRoom(displayNameOrPayload, membershipKey) {
        const displayName = normalizedDisplayName(
            typeof displayNameOrPayload === "object"
                ? displayNameOrPayload?.displayName
                : displayNameOrPayload
        );
        if (!displayName) {
            return error(
                "INVALID_DISPLAY_NAME",
                "Display name must contain 2 to 16 characters.",
                "displayName"
            );
        }
        if (typeof membershipKey !== "string" || membershipKey.length === 0) {
            return error(
                "MISSING_MEMBERSHIP_KEY",
                "A valid server membership key is required.",
                "membershipKey"
            );
        }
        if (this.membershipKeys.has(membershipKey)) {
            return error("ALREADY_IN_ROOM", "Player is already in a room.", "room");
        }

        let roomId;
        try {
            roomId = this.generateUniqueRoomId();
        } catch {
            return error("ROOM_ID_GENERATION_FAILED", "Unable to create a room.");
        }

        const room = {
            id: roomId,
            status: "waiting",
            roomRevision: 0,
            players: new Map()
        };
        this.rooms.set(roomId, room);

        const playerResult = this.addPlayer(room, displayName);
        if (!playerResult.ok) {
            this.rooms.delete(roomId);
            return playerResult;
        }
        const player = playerResult.player;
        this.membershipKeys.set(membershipKey, { roomId, playerId: player.id });
        room.roomRevision += 1;

        return {
            ok: true,
            room,
            player,
            changed: true
        };
    }

    addPlayer(room, displayName) {
        let playerId = null;
        for (let attempt = 0; attempt < 1000; attempt += 1) {
            const candidate = String(this.playerIdGenerator());
            if (!room.players.has(candidate) && !this.playerRooms.has(candidate)) {
                playerId = candidate;
                break;
            }
        }
        if (playerId === null) {
            return error(
                "PLAYER_ID_GENERATION_FAILED",
                "Unable to generate a unique player ID."
            );
        }

        const player = {
            id: playerId,
            displayName,
            status: "connected",
            connected: true,
            disconnected: false
        };
        room.players.set(playerId, player);
        this.playerRooms.set(playerId, room.id);
        return { ok: true, player };
    }

    joinRoom(roomIdOrPayload, displayNameOrPayload, membershipKey) {
        const roomId = typeof roomIdOrPayload === "object"
            ? roomIdOrPayload?.roomId
            : roomIdOrPayload;
        const displayNameValue = typeof roomIdOrPayload === "object"
            ? roomIdOrPayload?.displayName
            : displayNameOrPayload;
        const normalizedRoomId = typeof roomId === "string"
            ? roomId.trim().toUpperCase()
            : "";

        if (!/^[A-Z0-9]{6}$/.test(normalizedRoomId)) {
            return error("INVALID_ROOM_ID", "Room ID must contain 6 letters or numbers.", "roomId");
        }
        const displayName = normalizedDisplayName(displayNameValue);
        if (!displayName) {
            return error(
                "INVALID_DISPLAY_NAME",
                "Display name must contain 2 to 16 characters.",
                "displayName"
            );
        }
        if (typeof membershipKey !== "string" || membershipKey.length === 0) {
            return error(
                "MISSING_MEMBERSHIP_KEY",
                "A valid server membership key is required.",
                "membershipKey"
            );
        }
        if (this.membershipKeys.has(membershipKey)) {
            return error("ALREADY_IN_ROOM", "Player is already in a room.", "room");
        }

        const room = this.rooms.get(normalizedRoomId);
        if (!room) {
            return error("ROOM_NOT_FOUND", "Room was not found.", "roomId");
        }
        if (room.status === "playing") {
            return error("ROOM_ALREADY_STARTED", "Room has already started.", "room");
        }
        if (room.status !== "waiting") {
            return error("INVALID_ROOM_STATE", "Room cannot accept players in its current state.", "room");
        }
        if (room.players.size >= 4) {
            return error("ROOM_FULL", "Room is full.", "room");
        }

        const playerResult = this.addPlayer(room, displayName);
        if (!playerResult.ok) {
            return playerResult;
        }
        const player = playerResult.player;
        this.membershipKeys.set(membershipKey, { roomId: room.id, playerId: player.id });
        room.roomRevision += 1;

        return {
            ok: true,
            room,
            player,
            changed: true
        };
    }

    getRoom(roomId) {
        if (typeof roomId !== "string") {
            return null;
        }
        return this.rooms.get(roomId.trim().toUpperCase()) || null;
    }

    getRoomSnapshot(roomId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        return {
            roomId: room.id,
            status: room.status,
            roomRevision: room.roomRevision,
            players: [...room.players.values()].map(copyPlayer)
        };
    }

    getEligibleReplayParticipants(roomId) {
        const room = this.getRoom(roomId);
        if (!room || room.status !== "playing") {
            return [];
        }
        return [...room.players.values()]
            .filter(player => player.status === "connected"
                && player.connected !== false)
            .map(player => ({
                playerId: player.id,
                displayName: player.displayName
            }));
    }

    getPlayerRoom(playerId) {
        const roomId = this.playerRooms.get(playerId);
        return roomId ? this.rooms.get(roomId) || null : null;
    }

    isMembershipKeyInRoom(membershipKey) {
        return this.membershipKeys.has(membershipKey);
    }

    startRoom(roomIdOrPayload, playerId) {
        const roomId = typeof roomIdOrPayload === "object"
            ? roomIdOrPayload?.roomId
            : roomIdOrPayload;
        const room = typeof roomId === "string"
            ? this.getRoom(roomId)
            : null;
        if (!room) {
            return error("ROOM_NOT_FOUND", "Room was not found.", "roomId");
        }
        if (!playerId || !room.players.has(playerId)) {
            return error("NOT_IN_ROOM", "Player is not a member of this room.", "playerId");
        }
        const player = room.players.get(playerId);
        if (player.status !== "connected") {
            return error("NOT_IN_ROOM", "Player is not a connected member of this room.", "playerId");
        }
        if (room.status === "playing") {
            return error("ROOM_ALREADY_STARTED", "Room has already started.", "room");
        }
        if (room.status !== "waiting") {
            return error("INVALID_ROOM_STATE", "Room cannot start in its current state.", "room");
        }

        const connectedCount = [...room.players.values()]
            .filter((member) => member.status === "connected").length;
        if (connectedCount < 2) {
            return error("ROOM_NOT_READY", "Room requires at least 2 connected players.", "room");
        }
        if (connectedCount > 4) {
            return error("ROOM_FULL", "Room has too many players.", "room");
        }

        room.status = "playing";
        room.roomRevision += 1;
        return {
            ok: true,
            room,
            changed: true
        };
    }

    leaveRoom(roomIdOrPlayerId, playerId, reason = "disconnected") {
        let room;
        let resolvedPlayerId = playerId;

        if (typeof roomIdOrPlayerId === "string" && playerId === undefined) {
            resolvedPlayerId = roomIdOrPlayerId;
            room = this.getPlayerRoom(resolvedPlayerId);
        } else {
            room = typeof roomIdOrPlayerId === "string"
                ? this.getRoom(roomIdOrPlayerId)
                : null;
        }
        if (!room) {
            return error("ROOM_NOT_FOUND", "Room was not found.", "roomId");
        }
        if (!resolvedPlayerId || !room.players.has(resolvedPlayerId)) {
            return error("NOT_IN_ROOM", "Player is not a member of this room.", "playerId");
        }

        const player = room.players.get(resolvedPlayerId);
        if (room.status === "waiting") {
            room.players.delete(resolvedPlayerId);
            this.playerRooms.delete(resolvedPlayerId);
            this.removeMembershipKey(resolvedPlayerId);
            room.roomRevision += 1;

            if (room.players.size === 0) {
                this.rooms.delete(room.id);
                return {
                    ok: true,
                    room,
                    player,
                    removed: true,
                    deleted: true,
                    reason: reason === "explicit" ? "left" : "disconnected",
                    changed: true
                };
            }
            return {
                ok: true,
                room,
                player,
                removed: true,
                deleted: false,
                reason: reason === "explicit" ? "left" : "disconnected",
                changed: true
            };
        }

        if (room.status === "playing") {
            // MVP limitation: playing rooms are intentionally retained after every
            // player disconnects; there is no match completion or room expiration yet.
            if (player.status === "eliminated") {
                this.playerRooms.delete(resolvedPlayerId);
                this.removeMembershipKey(resolvedPlayerId);
                return {
                    ok: true,
                    room,
                    player,
                    removed: false,
                    eliminated: true,
                    alreadyHandled: true,
                    reason: player.leaveReason || "disconnected",
                    changed: false
                };
            }
            player.status = "eliminated";
            player.connected = false;
            player.disconnected = true;
            player.leaveReason = reason === "explicit" ? "left" : "disconnected";
            room.roomRevision += 1;
            this.playerRooms.delete(resolvedPlayerId);
            this.removeMembershipKey(resolvedPlayerId);
            return {
                ok: true,
                room,
                player,
                removed: false,
                released: true,
                eliminated: true,
                deleted: false,
                reason: player.leaveReason,
                changed: true
            };
        }

        return error("INVALID_ROOM_STATE", "Room cannot process leave in its current state.", "room");
    }

    removeMembershipKey(playerId) {
        for (const [key, membership] of this.membershipKeys.entries()) {
            if (membership.playerId === playerId) {
                this.membershipKeys.delete(key);
            }
        }
    }

    deleteRoom(roomId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return false;
        }
        for (const playerId of room.players.keys()) {
            this.playerRooms.delete(playerId);
            this.removeMembershipKey(playerId);
        }
        this.rooms.delete(room.id);
        return true;
    }
}

export default RoomManager;
