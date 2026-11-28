export const TILE = Object.freeze({
    FLOOR: 0,
    WALL: 1,
    BLOCK: 2
});

export const BOMB_DELAY_MS = 3000;
export const EXPLOSION_DURATION_MS = 500;
export const EXPLOSION_RANGE = 2;

const INITIAL_MAP = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 2, 0, 2, 0, 2, 0, 2, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1],
    [1, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    [1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 1],
    [1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1],
    [1, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 1],
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    [1, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 2, 0, 2, 0, 2, 0, 2, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

const INITIAL_PLAYERS = [{
    id: 1,
    name: "Namdo",
    x: 1,
    y: 1,
    alive: true
}];

export function cloneMap(map) {
    return map.map(row => row.slice());
}

function isValidPlayerId(id) {
    return (typeof id === "string" && id.length > 0)
        || (typeof id === "number" && Number.isSafeInteger(id));
}

function createPlayers(players) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
        throw new RangeError("Configured players must contain 2 to 4 players.");
    }

    const ids = new Set();
    const positions = new Set();
    return players.map((player) => {
        if (!player || !isValidPlayerId(player.id)) {
            throw new TypeError("Each configured player must have a valid ID.");
        }
        if (ids.has(player.id)) {
            throw new RangeError(`Duplicate player ID: ${player.id}`);
        }
        ids.add(player.id);

        const name = player.displayName ?? player.name;
        if (typeof name !== "string" || name.trim().length === 0) {
            throw new TypeError("Each configured player must have a display name.");
        }
        if (!Number.isInteger(player.x) || !Number.isInteger(player.y)
            || player.y < 0
            || player.y >= INITIAL_MAP.length
            || player.x < 0
            || player.x >= INITIAL_MAP[player.y].length
            || INITIAL_MAP[player.y][player.x] !== TILE.FLOOR) {
            throw new RangeError(`Invalid spawn position for player ${player.id}.`);
        }

        const position = `${player.x},${player.y}`;
        if (positions.has(position)) {
            throw new RangeError(`Duplicate spawn position: ${position}`);
        }
        positions.add(position);

        return {
            id: player.id,
            name: name.trim(),
            x: player.x,
            y: player.y,
            alive: true
        };
    });
}

export function createInitialState(configuredPlayers) {
    const playersConfiguration = Array.isArray(configuredPlayers)
        ? configuredPlayers
        : configuredPlayers?.players;
    const players = configuredPlayers === undefined
        ? INITIAL_PLAYERS.map(player => ({ ...player }))
        : createPlayers(playersConfiguration);

    return {
        map: cloneMap(INITIAL_MAP),
        initialPlayers: players.map(player => ({ ...player })),
        players: players.map(player => ({ ...player })),
        bombs: [],
        explosions: [],
        nextBombId: 1,
        status: "playing",
        result: null
    };
}
