import { performance } from "node:perf_hooks";
import {
    advanceTime,
    applyAction,
    eliminatePlayer
} from "../js/game-rules.js";
import { createInitialState } from "../js/game-state.js";

const SPAWN_POSITIONS = [
    { x: 1, y: 1 },
    { x: 13, y: 1 },
    { x: 1, y: 11 },
    { x: 13, y: 11 }
];

const DIRECTIONS = Object.freeze({
    up: Object.freeze({ dx: 0, dy: -1 }),
    down: Object.freeze({ dx: 0, dy: 1 }),
    left: Object.freeze({ dx: -1, dy: 0 }),
    right: Object.freeze({ dx: 1, dy: 0 })
});

function copy(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(copy);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
}

function stateFingerprint(state) {
    return JSON.stringify({
        map: state.map,
        players: state.players,
        bombs: state.bombs,
        explosions: state.explosions,
        status: state.status,
        result: state.result
    });
}

function error(code, field, message) {
    return {
        ok: false,
        error: { code, field, message }
    };
}

function participantConfiguration(participants) {
    const values = Array.isArray(participants) ? participants : participants?.players;
    if (!Array.isArray(values)) {
        throw new TypeError("Participants must be an array or a room snapshot.");
    }
    return values.map((participant, index) => {
        const id = participant?.playerId ?? participant?.id;
        const displayName = participant?.displayName ?? participant?.name;
        const spawn = SPAWN_POSITIONS[index];
        return {
            id,
            displayName,
            x: spawn.x,
            y: spawn.y
        };
    });
}

export class GameSession {
    constructor(roomId, participants, options = {}) {
        if (roomId && typeof roomId === "object") {
            options = roomId;
            roomId = options.roomId;
            participants = options.participants;
        }
        if (typeof roomId !== "string" || roomId.length === 0) {
            throw new TypeError("roomId must be a non-empty string.");
        }

        this.roomId = roomId;
        this.participants = participantConfiguration(participants);
        const configuredClock = options.clock || options.now;
        this.clock = typeof configuredClock === "function"
            ? configuredClock
            : configuredClock?.now || (() => performance.now());
        const timers = options.timers || {};
        this.setInterval = options.setInterval || timers.setInterval || globalThis.setInterval;
        this.clearInterval = options.clearInterval || timers.clearInterval || globalThis.clearInterval;
        this.tickIntervalMs = options.tickIntervalMs ?? 50;
        this.gameRevision = 0;
        this.gameEpoch = 1;
        this.lastSequences = new Map(this.participants.map(player => [player.id, -1]));
        this.eventHistory = [];
        this.timer = null;
        this.timerActive = false;
        this.lifecycleRequested = false;
        this.disposed = false;
        this.onChange = options.onChange;
        this.state = createInitialState(this.participants);

        if (options.autoStart === true) {
            this.start();
        }
    }

    start() {
        if (this.disposed) {
            return false;
        }
        this.lifecycleRequested = true;
        if (!this.timerActive && this.state.status === "playing") {
            this.timer = this.setInterval(() => this.tick(), this.tickIntervalMs);
            this.timerActive = true;
        }
        return true;
    }

    stop() {
        this.lifecycleRequested = false;
        this.stopTimer();
    }

    stopTimer() {
        if (this.timerActive) {
            this.clearInterval(this.timer);
            this.timer = null;
            this.timerActive = false;
        }
    }

    tick() {
        return this.advanceTime();
    }

    advanceTime() {
        if (this.disposed || this.state.status !== "playing") {
            return { changed: false, events: [] };
        }

        const result = advanceTime(this.state, this.clock());
        const changed = this.commit(result);
        if (this.state.status === "finished") {
            this.stopTimer();
        }
        return { changed, events: copy(result.events) };
    }

    processAction(playerId, action, sequence, gameEpoch = this.gameEpoch) {
        if (this.disposed) {
            return error("INVALID_ROOM_STATE", "room", "Game session has been disposed.");
        }
        if (!this.lastSequences.has(playerId)) {
            return error("NOT_IN_ROOM", "playerId", "Player is not a member of this session.");
        }
        if (!Number.isSafeInteger(gameEpoch) || gameEpoch !== this.gameEpoch) {
            return error("INVALID_GAME_EPOCH", "gameEpoch", "Game epoch is stale or invalid.");
        }
        if (!Number.isSafeInteger(sequence) || sequence < 0
            || sequence <= this.lastSequences.get(playerId)) {
            return error("INVALID_SEQUENCE", "sequence", "Sequence must be newer than the last sequence.");
        }
        if (this.state.status !== "playing") {
            return error("INVALID_ROOM_STATE", "room", "The match has already finished.");
        }

        const player = this.state.players.find(candidate => candidate.id === playerId);
        if (!player || !player.alive) {
            return error("INVALID_ACTION", "playerId", "Eliminated players cannot act.");
        }
        const coreAction = this.toCoreAction(playerId, action);
        if (!coreAction) {
            return error("INVALID_ACTION", "action", "Action is invalid.");
        }

        const result = applyAction(this.state, coreAction, this.clock());
        this.lastSequences.set(playerId, sequence);
        const changed = this.commit(result);
        return {
            ok: true,
            changed,
            events: copy(result.events),
            snapshot: this.getSnapshot()
        };
    }

    toCoreAction(playerId, action) {
        if (!action || typeof action !== "object") {
            return null;
        }
        if (action.type === "place-bomb") {
            return { playerId, type: "place-bomb" };
        }
        if (action.type === "move" && DIRECTIONS[action.direction]) {
            return { playerId, type: "move", ...DIRECTIONS[action.direction] };
        }
        return null;
    }

    eliminateParticipant(playerId) {
        if (this.disposed || !this.lastSequences.has(playerId)) {
            return error("NOT_IN_ROOM", "playerId", "Player is not a member of this session.");
        }
        const result = eliminatePlayer(this.state, playerId);
        const changed = this.commit(result);
        if (this.state.status === "finished") {
            this.stopTimer();
        }
        return {
            ok: changed,
            changed,
            events: copy(result.events),
            snapshot: this.getSnapshot()
        };
    }

    reset(playerId, sequence, gameEpoch = this.gameEpoch, eligibleParticipants) {
        if (this.disposed) {
            return error("INVALID_ROOM_STATE", "room", "Game session has been disposed.");
        }
        if (playerId !== undefined && !this.lastSequences.has(playerId)) {
            return error("NOT_IN_ROOM", "playerId", "Player is not a member of this session.");
        }
        if (!Number.isSafeInteger(gameEpoch) || gameEpoch !== this.gameEpoch) {
            return error("INVALID_GAME_EPOCH", "gameEpoch", "Game epoch is stale or invalid.");
        }
        if (sequence !== undefined
            && (!Number.isSafeInteger(sequence) || sequence < 0
                || sequence <= this.lastSequences.get(playerId))) {
            return error("INVALID_SEQUENCE", "sequence", "Sequence must be newer than the last sequence.");
        }
        if (this.state.status !== "finished") {
            return error("INVALID_ROOM_STATE", "room", "Only finished matches can be reset.");
        }

        const configuredParticipants = eligibleParticipants === undefined
            ? this.participants
            : participantConfiguration(eligibleParticipants);
        if (configuredParticipants.length < 2 || configuredParticipants.length > 4) {
            return error(
                "INSUFFICIENT_ELIGIBLE_PLAYERS",
                "players",
                "Replay requires at least 2 connected eligible players."
            );
        }

        this.participants = configuredParticipants;
        this.lastSequences = new Map(this.participants.map(player => [player.id, -1]));
        const result = {
            state: createInitialState(this.participants),
            events: [{ type: "game-reset" }]
        };
        if (sequence !== undefined) {
            this.lastSequences.set(playerId, sequence);
        }
        this.gameEpoch += 1;
        this.commit(result);
        if (this.lifecycleRequested) {
            this.start();
        }
        return {
            ok: true,
            changed: true,
            events: copy(result.events),
            snapshot: this.getSnapshot()
        };
    }

    commit(result) {
        const changed = stateFingerprint(this.state) !== stateFingerprint(result.state);
        if (changed) {
            this.state = result.state;
            this.gameRevision += 1;
            this.eventHistory.push(...copy(result.events));
            if (typeof this.onChange === "function") {
                this.onChange({
                    snapshot: this.getSnapshot(),
                    events: copy(result.events)
                });
            }
        }
        return changed;
    }

    getSnapshot() {
        return {
            roomId: this.roomId,
            gameRevision: this.gameRevision,
            gameEpoch: this.gameEpoch,
            status: this.state.status,
            result: copy(this.state.result),
            players: copy(this.state.players),
            bombs: copy(this.state.bombs),
            explosions: copy(this.state.explosions),
            map: copy(this.state.map)
        };
    }

    getEvents() {
        return copy(this.eventHistory);
    }

    drainEvents() {
        const events = this.getEvents();
        this.eventHistory = [];
        return events;
    }

    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.lifecycleRequested = false;
        this.stopTimer();
    }
}

export default GameSession;
