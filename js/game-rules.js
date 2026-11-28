import {
    BOMB_DELAY_MS,
    EXPLOSION_DURATION_MS,
    EXPLOSION_RANGE,
    TILE,
    createInitialState
} from "./game-state.js";

const DIRECTIONS = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
];

function cloneState(state) {
    return {
        map: state.map.map(row => row.slice()),
        initialPlayers: state.initialPlayers.map(player => ({ ...player })),
        players: state.players.map(player => ({ ...player })),
        bombs: state.bombs.map(bomb => ({ ...bomb })),
        explosions: state.explosions.map(explosion => ({ ...explosion })),
        nextBombId: state.nextBombId,
        status: state.status,
        result: state.result ? { ...state.result } : null
    };
}

function isValidPosition(map, x, y) {
    return Number.isInteger(x)
        && Number.isInteger(y)
        && y >= 0
        && y < map.length
        && Array.isArray(map[y])
        && x >= 0
        && x < map[y].length;
}

function getPlayer(state, playerId) {
    return state.players.find(player => player.id === playerId);
}

function getAlivePlayers(state) {
    return state.players.filter(player => player.alive);
}

function evaluateMatch(state, events) {
    if (state.status !== "playing") {
        return;
    }

    const alivePlayers = getAlivePlayers(state);
    if (alivePlayers.length > 1) {
        return;
    }

    state.status = "finished";
    state.result = alivePlayers.length === 1
        ? { type: "win", winnerId: alivePlayers[0].id }
        : { type: "draw", winnerId: null };
    emit(events, "match-finished", { result: { ...state.result } });
}

function hasBombAt(state, x, y) {
    return state.bombs.some(bomb => bomb.x === x && bomb.y === y);
}

function emit(events, type, data = {}) {
    events.push({ type, ...data });
}

function killPlayersInExplosions(state, explosions, events) {
    for (const player of state.players) {
        if (player.alive && explosions.some(cell => cell.x === player.x && cell.y === player.y)) {
            player.alive = false;
            emit(events, "player-killed", { playerId: player.id });
        }
    }
}

function addExplosion(state, x, y, expiresAt, events) {
    if (!isValidPosition(state.map, x, y)) {
        return;
    }

    const newExplosions = [{ x, y, expiresAt }];
    for (const direction of DIRECTIONS) {
        for (let distance = 1; distance <= EXPLOSION_RANGE; distance++) {
            const explosionX = x + direction.dx * distance;
            const explosionY = y + direction.dy * distance;

            if (!isValidPosition(state.map, explosionX, explosionY)) {
                break;
            }

            const tileType = state.map[explosionY][explosionX];
            if (tileType === TILE.WALL) {
                break;
            }

            newExplosions.push({ x: explosionX, y: explosionY, expiresAt });

            if (tileType === TILE.BLOCK) {
                state.map[explosionY][explosionX] = TILE.FLOOR;
                emit(events, "block-destroyed", { x: explosionX, y: explosionY });
                break;
            }

            const hitBomb = state.bombs.find(bomb => bomb.x === explosionX && bomb.y === explosionY);
            if (hitBomb) {
                explodeBomb(state, hitBomb.id, expiresAt, events);
                break;
            }
        }
    }

    state.explosions.push(...newExplosions);
    killPlayersInExplosions(state, newExplosions, events);
}

function explodeBomb(state, bombId, now, events) {
    const bombIndex = state.bombs.findIndex(bomb => bomb.id === bombId);
    if (bombIndex === -1) {
        return;
    }

    const [bomb] = state.bombs.splice(bombIndex, 1);
    emit(events, "bomb-exploded", { bombId: bomb.id, x: bomb.x, y: bomb.y });
    addExplosion(state, bomb.x, bomb.y, now + EXPLOSION_DURATION_MS, events);
}

function expireExplosions(state, now) {
    state.explosions = state.explosions.filter(explosion => explosion.expiresAt > now);
}

export function applyAction(currentState, action, now) {
    const state = cloneState(currentState);
    const events = [];

    if (action?.type === "reset") {
        if (!getPlayer(state, action.playerId)) {
            return { state: currentState, events };
        }
        const resetState = state.initialPlayers.length === 1
            ? createInitialState()
            : createInitialState(state.initialPlayers);
        return { state: resetState, events: [{ type: "game-reset" }] };
    }

    const player = getPlayer(state, action?.playerId);
    if (!player || !player.alive || state.status !== "playing") {
        return { state: currentState, events };
    }

    if (action.type === "place-bomb") {
        if (isValidPosition(state.map, player.x, player.y)
            && state.map[player.y][player.x] === TILE.FLOOR
            && !hasBombAt(state, player.x, player.y)) {
            const bomb = {
                id: state.nextBombId++,
                ownerId: player.id,
                x: player.x,
                y: player.y,
                explodesAt: now + BOMB_DELAY_MS
            };
            state.bombs.push(bomb);
            emit(events, "bomb-placed", { bombId: bomb.id, x: bomb.x, y: bomb.y });
            return { state, events };
        }
        return { state: currentState, events };
    }

    if (action.type === "move") {
        const newX = player.x + action.dx;
        const newY = player.y + action.dy;
        if (isValidPosition(state.map, player.x, player.y)
            && isValidPosition(state.map, newX, newY)
            && state.map[player.y][player.x] === TILE.FLOOR
            && state.map[newY][newX] === TILE.FLOOR
            && !hasBombAt(state, newX, newY)
            && !state.players.some(otherPlayer => otherPlayer.alive
                && otherPlayer.id !== player.id
                && otherPlayer.x === newX
                && otherPlayer.y === newY)) {
            player.x = newX;
            player.y = newY;
            emit(events, "player-moved", { playerId: player.id, x: newX, y: newY });
            return { state, events };
        }
    }

    return { state: currentState, events };
}

export function eliminatePlayer(currentState, playerId) {
    const player = getPlayer(currentState, playerId);
    if (!player || !player.alive || currentState.status !== "playing") {
        return { state: currentState, events: [] };
    }

    const state = cloneState(currentState);
    const eliminatedPlayer = getPlayer(state, playerId);
    eliminatedPlayer.alive = false;
    const events = [];
    emit(events, "player-killed", { playerId });
    if (events.some(event => event.type === "player-killed")) {
        evaluateMatch(state, events);
    }
    return { state, events };
}

export function advanceTime(currentState, now) {
    let state = cloneState(currentState);
    const events = [];
    const dueBombs = state.bombs
        .filter(bomb => bomb.explodesAt <= now)
        .map(bomb => bomb.id);

    for (const bombId of dueBombs) {
        explodeBomb(state, bombId, now, events);
    }

    expireExplosions(state, now);
    if (events.some(event => event.type === "player-killed")) {
        evaluateMatch(state, events);
    }
    return { state, events };
}
