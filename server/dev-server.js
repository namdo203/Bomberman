import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
    createRejection,
    PROTOCOL_EVENTS,
    validateRequest
} from "../js/protocol.js";
import { GameSession } from "./game-session.js";
import { RoomManager } from "./room-manager.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
const port = Number(process.env.PORT || 8080);
const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
};

function createHttpServer() {
    return createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const filePath = normalize(join(root, relativePath));

    if ((filePath !== root && !filePath.startsWith(rootPrefix)) || !statExists(filePath)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }

    response.writeHead(200, {
        "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
    });
}

export const roomManager = new RoomManager();

export function createDevelopmentServer(manager = new RoomManager()) {
    const server = createHttpServer();
    const io = new Server(server);
    const gameSessions = new Map();

    function disposeSession(roomId) {
        const session = gameSessions.get(roomId);
        if (!session) {
            return;
        }
        session.dispose();
        gameSessions.delete(roomId);
    }

    function broadcastSessionChange(roomId, change) {
        const payload = {
            ...change.snapshot,
            events: change.events
        };
        io.to(roomId).emit(PROTOCOL_EVENTS.responses.gameUpdated, payload);
        if (change.snapshot.status === "finished") {
            io.to(roomId).emit(PROTOCOL_EVENTS.responses.gameFinished, payload);
        }
    }

    function createSession(roomId) {
        if (gameSessions.has(roomId)) {
            return gameSessions.get(roomId);
        }
        const roomSnapshot = manager.getRoomSnapshot(roomId);
        if (!roomSnapshot || roomSnapshot.status !== "playing") {
            return null;
        }
        const session = new GameSession(roomId, roomSnapshot.players, {
            autoStart: true,
            onChange: (change) => {
                if (gameSessions.get(roomId) === session) {
                    broadcastSessionChange(roomId, change);
                }
            }
        });
        gameSessions.set(roomId, session);
        return session;
    }

    function getSessionForSocket(socket) {
        const roomId = socket.data.roomId;
        const playerId = socket.data.playerId;
        const room = roomId ? manager.getRoom(roomId) : null;
        const member = room && playerId ? room.players.get(playerId) : null;
        const session = roomId ? gameSessions.get(roomId) : null;
        if (!room || room.status !== "playing" || !member
            || member.status !== "connected" || !session) {
            return null;
        }
        return { roomId, playerId, session };
    }

    io.on("connection", (socket) => {
        console.log(`Socket.IO client connected: ${socket.id}`);

        for (const eventName of Object.values(PROTOCOL_EVENTS.requests)) {
            socket.on(eventName, (payload, acknowledge) => {
                const validation = validateRequest(eventName, payload);
                if (!validation.ok) {
                    const rejection = createRejection(eventName, validation);
                    socket.emit(PROTOCOL_EVENTS.responses.rejection, rejection);
                    if (typeof acknowledge === "function") {
                        acknowledge(rejection);
                    }
                    return;
                }

                handleRoomRequest(
                    io,
                    manager,
                    socket,
                    eventName,
                    validation.value,
                    acknowledge,
                    createSession,
                    getSessionForSocket,
                    gameSessions,
                    disposeSession
                );
            });
        }

        socket.on("disconnect", (reason) => {
            handleSocketLeave(
                io,
                manager,
                socket,
                undefined,
                "disconnected",
                gameSessions,
                disposeSession
            );
            console.log(`Socket.IO client disconnected: ${socket.id} (${reason})`);
        });
    });

    server.on("close", () => {
        for (const roomId of [...gameSessions.keys()]) {
            disposeSession(roomId);
        }
    });

    return { server, io, roomManager: manager, gameSessions };
}

function rejectRequest(socket, eventName, result, acknowledge) {
    const rejection = createRejection(eventName, result);
    socket.emit(PROTOCOL_EVENTS.responses.rejection, rejection);
    if (typeof acknowledge === "function") {
        acknowledge(rejection);
    }
}

function rejectStaleEpoch(socket, eventName, acknowledge) {
    rejectRequest(socket, eventName, {
        ok: false,
        error: {
            code: "INVALID_GAME_EPOCH",
            field: "gameEpoch",
            message: "Game epoch is stale or invalid."
        }
    }, acknowledge);
}

function handleRoomRequest(
    io,
    manager,
    socket,
    eventName,
    payload,
    acknowledge,
    createSession,
    getSessionForSocket,
    gameSessions,
    disposeSession
) {
    const requests = PROTOCOL_EVENTS.requests;
    const responses = PROTOCOL_EVENTS.responses;

    if (eventName === requests.createRoom) {
        if (socket.data.roomId && socket.data.playerId) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "ALREADY_IN_ROOM",
                    field: "room",
                    message: "Socket is already in a room."
                }
            }, acknowledge);
            return;
        }

        const result = manager.createRoom(payload.displayName, socket.id);
        if (!result.ok) {
            rejectRequest(socket, eventName, result, acknowledge);
            return;
        }

        socket.data.roomId = result.room.id;
        socket.data.playerId = result.player.id;
        socket.join(result.room.id);

        const roomSnapshot = manager.getRoomSnapshot(result.room.id);
        socket.emit(responses.roomJoined, {
            ...roomSnapshot,
            playerId: result.player.id
        });
        io.to(result.room.id).emit(responses.roomUpdated, roomSnapshot);
        acknowledgeSuccess(acknowledge);
        return;
    }

    if (eventName === requests.joinRoom) {
        if (socket.data.roomId && socket.data.playerId) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "ALREADY_IN_ROOM",
                    field: "room",
                    message: "Socket is already in a room."
                }
            }, acknowledge);
            return;
        }

        const result = manager.joinRoom(
            payload.roomId,
            payload.displayName,
            socket.id
        );
        if (!result.ok) {
            rejectRequest(socket, eventName, result, acknowledge);
            return;
        }

        socket.data.roomId = result.room.id;
        socket.data.playerId = result.player.id;
        socket.join(result.room.id);

        const roomSnapshot = manager.getRoomSnapshot(result.room.id);
        socket.emit(responses.roomJoined, {
            ...roomSnapshot,
            playerId: result.player.id
        });
        socket.to(result.room.id).emit(responses.playerJoined, {
            roomId: result.room.id,
            roomRevision: roomSnapshot.roomRevision,
            player: {
                playerId: result.player.id,
                displayName: result.player.displayName,
                status: result.player.status
            }
        });
        io.to(result.room.id).emit(responses.roomUpdated, roomSnapshot);
        acknowledgeSuccess(acknowledge);
        return;
    }

    if (eventName === requests.startRoom) {
        const roomId = socket.data.roomId;
        const playerId = socket.data.playerId;
        if (!roomId || !playerId) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "NOT_IN_ROOM",
                    field: "room",
                    message: "Socket is not in a room."
                }
            }, acknowledge);
            return;
        }

        const result = manager.startRoom(roomId, playerId);
        if (!result.ok) {
            rejectRequest(socket, eventName, result, acknowledge);
            return;
        }

        const session = createSession(roomId);
        if (!session) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "INVALID_ROOM_STATE",
                    field: "room",
                    message: "Unable to create the game session."
                }
            }, acknowledge);
            return;
        }

        const roomSnapshot = manager.getRoomSnapshot(roomId);
        io.to(roomId).emit(responses.gameStarted, {
            ...session.getSnapshot(),
            roomRevision: roomSnapshot.roomRevision
        });
        io.to(roomId).emit(responses.roomUpdated, roomSnapshot);
        acknowledgeSuccess(acknowledge);
        return;
    }

    if (eventName === requests.gameAction) {
        const membership = getSessionForSocket(socket);
        if (!membership) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "NOT_IN_ROOM",
                    field: "room",
                    message: "Socket is not a connected member of a playing room."
                }
            }, acknowledge);
            return;
        }

        if (payload.gameEpoch !== membership.session.gameEpoch) {
            rejectStaleEpoch(socket, eventName, acknowledge);
            return;
        }

        const result = membership.session.processAction(
            membership.playerId,
            payload.action,
            payload.sequence,
            payload.gameEpoch
        );
        if (!result.ok) {
            rejectRequest(socket, eventName, result, acknowledge);
            return;
        }
        if (typeof acknowledge === "function") {
            acknowledge({
                ok: true,
                changed: result.changed,
                gameEpoch: result.snapshot.gameEpoch
            });
        }
        return;
    }

    if (eventName === requests.resetGame) {
        const membership = getSessionForSocket(socket);
        if (!membership) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "NOT_IN_ROOM",
                    field: "room",
                    message: "Socket is not a connected member of a playing room."
                }
            }, acknowledge);
            return;
        }

        if (payload.gameEpoch !== membership.session.gameEpoch) {
            rejectStaleEpoch(socket, eventName, acknowledge);
            return;
        }

        const eligibleParticipants = manager
            .getEligibleReplayParticipants(membership.roomId);
        if (eligibleParticipants.length < 2) {
            rejectRequest(socket, eventName, {
                ok: false,
                error: {
                    code: "INSUFFICIENT_ELIGIBLE_PLAYERS",
                    field: "players",
                    message: "Replay requires at least 2 connected eligible players."
                }
            }, acknowledge);
            return;
        }

        const result = membership.session.reset(
            membership.playerId,
            payload.sequence,
            payload.gameEpoch,
            eligibleParticipants
        );
        if (!result.ok) {
            rejectRequest(socket, eventName, result, acknowledge);
            return;
        }
        if (typeof acknowledge === "function") {
            acknowledge({
                ok: true,
                changed: result.changed,
                gameEpoch: result.snapshot.gameEpoch
            });
        }
        return;
    }

    if (eventName === requests.leaveRoom) {
        handleSocketLeave(
            io,
            manager,
            socket,
            acknowledge,
            "explicit",
            gameSessions,
            disposeSession
        );
        return;
    }

    acknowledgeSuccess(acknowledge);
}

function acknowledgeSuccess(acknowledge) {
    if (typeof acknowledge === "function") {
        acknowledge({ ok: true });
    }
}

function handleSocketLeave(
    io,
    manager,
    socket,
    acknowledge,
    reason = "disconnected",
    gameSessions,
    disposeSession
) {
    const roomId = socket.data.roomId;
    const playerId = socket.data.playerId;
    if (!roomId || !playerId) {
        if (acknowledge) {
            rejectRequest(socket, PROTOCOL_EVENTS.requests.leaveRoom, {
                ok: false,
                error: {
                    code: "NOT_IN_ROOM",
                    field: "room",
                    message: "Socket is not in a room."
                }
            }, acknowledge);
        }
        return;
    }

    const result = manager.leaveRoom(roomId, playerId, reason);
    if (!result.ok) {
        if (acknowledge) {
            rejectRequest(socket, PROTOCOL_EVENTS.requests.leaveRoom, result, acknowledge);
        }
        return;
    }

    if (reason === "explicit" || result.deleted || result.removed) {
        socket.leave(roomId);
    }

    if (result.eliminated && manager.getRoom(roomId)?.status === "playing") {
        const session = gameSessions.get(roomId);
        if (session) {
            session.eliminateParticipant(playerId);
        }
    }

    if (result.changed) {
        io.to(roomId).emit(PROTOCOL_EVENTS.responses.playerLeft, {
            roomId,
            roomRevision: result.room.roomRevision,
            playerId,
            reason: result.reason
        });

        if (manager.getRoom(roomId)) {
            const roomSnapshot = manager.getRoomSnapshot(roomId);
            io.to(roomId).emit(PROTOCOL_EVENTS.responses.roomUpdated, roomSnapshot);
        }
    }

    if (result.removed || result.released) {
        socket.data.roomId = undefined;
        socket.data.playerId = undefined;
    }

    if (result.deleted) {
        disposeSession(roomId);
    }

    acknowledgeSuccess(acknowledge);
}

function statExists(filePath) {
    try {
        return statSync(filePath).isFile();
    } catch {
        return false;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const app = createDevelopmentServer(roomManager);
    app.server.listen(port, () => {
        console.log(`Bomberman served at http://localhost:${port}`);
    });
}
