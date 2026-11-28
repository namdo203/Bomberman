import { PROTOCOL_EVENTS } from "./protocol.js";

function copy(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(copy);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
}

export class NetworkSession {
    constructor(socketOrOptions, options = {}) {
        const configured = typeof socketOrOptions?.on === "function"
            ? { ...options, socket: socketOrOptions }
            : { ...(socketOrOptions || {}), ...options };

        if (!configured.socket || typeof configured.socket.on !== "function") {
            throw new TypeError("A Socket.IO client is required.");
        }

        this.socket = configured.socket;
        this.sequence = 0;
        this.gameEpoch = null;
        this.roomId = null;
        this.room = null;
        this.playerId = null;
        this.state = null;
        this.gameRevision = null;
        this.gameEpoch = null;
        this.listeners = new Map();
        this.disposed = false;

        this.onStateChange = configured.onStateChange;
        this.onRoomChange = configured.onRoomChange;
        this.onEvent = configured.onEvent;
        this.onRequestError = configured.onRequestError;

        this.registerListeners();
    }

    registerListeners() {
        this.addListener(PROTOCOL_EVENTS.responses.roomJoined, payload => {
            if (!payload || typeof payload !== "object") {
                return;
            }
            if (payload.roomId
                && this.roomId
                && payload.roomId !== this.roomId) {
                this.state = null;
                this.gameEpoch = null;
                this.gameRevision = null;
                if (typeof this.onStateChange === "function") {
                    this.onStateChange(null, []);
                }
            }
            this.roomId = payload.roomId || null;
            this.playerId = payload.playerId || null;
            this.room = copy(payload);
            if (typeof this.onRoomChange === "function") {
                this.onRoomChange(copy(this.room));
            }
            if (typeof this.onEvent === "function") {
                this.onEvent(copy(payload));
            }
        });

        this.addListener(PROTOCOL_EVENTS.responses.roomUpdated, payload => {
            if (!payload || typeof payload !== "object") {
                return;
            }
            if (payload.roomId && this.roomId && payload.roomId !== this.roomId) {
                return;
            }
            if (payload.roomId && !this.roomId) {
                this.roomId = payload.roomId;
            }
            this.room = copy(payload);
            if (typeof this.onRoomChange === "function") {
                this.onRoomChange(copy(this.room));
            }
            if (typeof this.onEvent === "function") {
                this.onEvent(copy(payload));
            }
        });

        for (const eventName of [
            PROTOCOL_EVENTS.responses.playerJoined,
            PROTOCOL_EVENTS.responses.playerLeft
        ]) {
            this.addListener(eventName, payload => {
                if (typeof this.onEvent === "function") {
                    this.onEvent(copy(payload));
                }
            });
        }

        for (const eventName of [
            PROTOCOL_EVENTS.responses.gameStarted,
            PROTOCOL_EVENTS.responses.gameUpdated,
            PROTOCOL_EVENTS.responses.gameFinished
        ]) {
            this.addListener(eventName, payload => this.acceptSnapshot(payload, eventName));
        }

        this.addListener(PROTOCOL_EVENTS.responses.rejection, payload => {
            if (typeof this.onRequestError === "function") {
                this.onRequestError(copy(payload));
            }
            if (typeof this.onEvent === "function") {
                this.onEvent(copy(payload));
            }
        });
    }

    addListener(eventName, listener) {
        this.socket.on(eventName, listener);
        this.listeners.set(eventName, listener);
    }

    reportLocalRequestError(requestEvent, code, field, message) {
        const rejection = {
            requestEvent,
            error: { code, field, message }
        };
        if (typeof this.onRequestError === "function") {
            this.onRequestError(copy(rejection));
        }
        if (typeof this.onEvent === "function") {
            this.onEvent(copy(rejection));
        }
    }

    acceptSnapshot(snapshot, eventName) {
        if (!snapshot || typeof snapshot !== "object") {
            return;
        }
        if (!snapshot.roomId || (this.roomId && snapshot.roomId !== this.roomId)) {
            return;
        }
        if (!this.roomId) {
            this.roomId = snapshot.roomId;
        }

        const incomingEpoch = snapshot.gameEpoch;
        if (!Number.isSafeInteger(incomingEpoch) || incomingEpoch < 1) {
            return;
        }
        if (!Number.isSafeInteger(snapshot.gameRevision) || snapshot.gameRevision < 0) {
            return;
        }

        if (this.gameEpoch !== null && incomingEpoch < this.gameEpoch) {
            return;
        }
        if (incomingEpoch === this.gameEpoch
            && snapshot.gameRevision <= this.gameRevision) {
            return;
        }

        if (incomingEpoch > this.gameEpoch || this.gameEpoch === null) {
            this.gameEpoch = incomingEpoch;
            this.gameRevision = snapshot.gameRevision;
        } else {
            this.gameRevision = snapshot.gameRevision;
        }
        this.state = copy(snapshot);

        const events = Array.isArray(snapshot.events) ? copy(snapshot.events) : [];
        if (typeof this.onStateChange === "function") {
            this.onStateChange(copy(this.state), events);
        }
        if (typeof this.onEvent === "function") {
            this.onEvent({
                type: eventName,
                payload: copy(snapshot)
            });
        }
    }

    createRoom(displayName) {
        this.socket.emit(PROTOCOL_EVENTS.requests.createRoom, { displayName });
    }

    joinRoom(roomId, displayName) {
        this.socket.emit(PROTOCOL_EVENTS.requests.joinRoom, { roomId, displayName });
    }

    startRoom() {
        this.socket.emit(PROTOCOL_EVENTS.requests.startRoom, {});
    }

    nextSequence() {
        const sequence = this.sequence;
        this.sequence += 1;
        return sequence;
    }

    dispatch(action) {
        let protocolAction = null;
        if (action?.type === "place-bomb") {
            protocolAction = { type: "place-bomb" };
        } else if (action?.type === "move"
            && ["up", "down", "left", "right"].includes(action.direction)) {
            protocolAction = { type: "move", direction: action.direction };
        } else if (action && action.dx !== undefined && action.dy !== undefined) {
            if (action.dx === 0 && action.dy === -1) {
                protocolAction = { type: "move", direction: "up" };
            } else if (action.dx === 0 && action.dy === 1) {
                protocolAction = { type: "move", direction: "down" };
            } else if (action.dx === -1 && action.dy === 0) {
                protocolAction = { type: "move", direction: "left" };
            } else if (action.dx === 1 && action.dy === 0) {
                protocolAction = { type: "move", direction: "right" };
            }
        }
        if (!protocolAction) {
            return;
        }
        if (!Number.isSafeInteger(this.gameEpoch) || this.gameEpoch < 1) {
            this.reportLocalRequestError(
                PROTOCOL_EVENTS.requests.gameAction,
                "INVALID_GAME_EPOCH",
                "gameEpoch",
                "A valid game epoch is not available."
            );
            return;
        }

        this.socket.emit(PROTOCOL_EVENTS.requests.gameAction, {
            sequence: this.nextSequence(),
            gameEpoch: this.gameEpoch,
            action: protocolAction
        });
    }

    reset() {
        if (!Number.isSafeInteger(this.gameEpoch) || this.gameEpoch < 1) {
            this.reportLocalRequestError(
                PROTOCOL_EVENTS.requests.resetGame,
                "INVALID_GAME_EPOCH",
                "gameEpoch",
                "A valid game epoch is not available."
            );
            return;
        }
        this.socket.emit(PROTOCOL_EVENTS.requests.resetGame, {
            sequence: this.nextSequence(),
            gameEpoch: this.gameEpoch
        });
    }

    leave(onAcknowledged) {
        this.socket.emit(PROTOCOL_EVENTS.requests.leaveRoom, {}, acknowledgment => {
            const succeeded = acknowledgment?.ok === true
                || (acknowledgment && acknowledgment.error === undefined);
            if (succeeded) {
                this.room = null;
                this.roomId = null;
                this.playerId = null;
                this.state = null;
                this.gameRevision = null;
                this.gameEpoch = null;
            }
            if (typeof onAcknowledged === "function") {
                onAcknowledged(acknowledgment);
            }
        });
    }

    disconnect() {
        if (this.disposed) {
            return;
        }
        for (const [eventName, listener] of this.listeners) {
            if (typeof this.socket.off === "function") {
                this.socket.off(eventName, listener);
            } else if (typeof this.socket.removeListener === "function") {
                this.socket.removeListener(eventName, listener);
            }
        }
        this.listeners.clear();
        this.disposed = true;
        this.room = null;
        this.roomId = null;
        this.playerId = null;
        this.state = null;
        this.gameRevision = null;
        this.gameEpoch = null;
    }

    getState() {
        return this.state === null ? null : copy(this.state);
    }

    getRoom() {
        return this.room === null ? null : copy(this.room);
    }

    getPlayerId() {
        return this.playerId;
    }
}

export function createNetworkSession(socketOrOptions, options = {}) {
    return new NetworkSession(socketOrOptions, options);
}
