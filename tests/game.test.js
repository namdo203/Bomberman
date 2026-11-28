import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceTime, applyAction, eliminatePlayer } from "../js/game-rules.js";
import { createInitialState, TILE } from "../js/game-state.js";

function action(state, value, now = 0) {
    return applyAction(state, { playerId: 1, ...value }, now);
}

test("initial map has playable symmetric dimensions and spawn corridors", () => {
    const state = createInitialState();
    const symbolicMap = [
        "###############",
        "#...+.+.+.+...#",
        "#...X.X.X.X...#",
        "#+.+.+.+.+.+.+#",
        "#.X.X.X.X.X.X.#",
        "#+...+...+...+#",
        "#.X+X.X+X.X+X.#",
        "#+...+...+...+#",
        "#.X.X.X.X.X.X.#",
        "#+.+.+.+.+.+.+#",
        "#...X.X.X.X...#",
        "#...+.+.+.+...#",
        "###############"
    ];
    const expectedMap = symbolicMap.map(row => [...row].map(tile => {
        if (tile === "#") return TILE.WALL;
        if (tile === "X") return TILE.WALL;
        if (tile === "+") return TILE.BLOCK;
        return TILE.FLOOR;
    }));
    assert.deepEqual(state.map, expectedMap);

    assert.equal(state.map.length, 13);
    assert.ok(state.map.every(row => row.length === 15));
    assert.ok(state.map.flat().every(tile =>
        tile === TILE.FLOOR || tile === TILE.WALL || tile === TILE.BLOCK
    ));

    assert.ok(state.map[0].every(tile => tile === TILE.WALL));
    assert.ok(state.map[12].every(tile => tile === TILE.WALL));
    assert.ok(state.map.every(row => row[0] === TILE.WALL && row[14] === TILE.WALL));

    for (let y = 0; y < state.map.length; y += 1) {
        for (let x = 0; x < state.map[y].length; x += 1) {
            assert.equal(
                state.map[y][x],
                state.map[12 - y][14 - x],
                `Map should be symmetric at (${x}, ${y})`
            );
        }
    }

    const spawns = [
        { x: 1, y: 1 },
        { x: 13, y: 1 },
        { x: 1, y: 11 },
        { x: 13, y: 11 }
    ];
    for (const spawn of spawns) {
        assert.equal(state.map[spawn.y][spawn.x], TILE.FLOOR);
        const adjacent = [
            [spawn.x - 1, spawn.y],
            [spawn.x + 1, spawn.y],
            [spawn.x, spawn.y - 1],
            [spawn.x, spawn.y + 1]
        ];
        const accessibleAdjacent = adjacent.filter(([x, y]) =>
            y >= 0 && y < state.map.length
            && x >= 0 && x < state.map[y].length
            && state.map[y][x] === TILE.FLOOR
        );
        assert.ok(accessibleAdjacent.length >= 2,
            `Spawn (${spawn.x}, ${spawn.y}) should have at least two open neighbors`);

        const visited = new Set([`${spawn.x},${spawn.y}`]);
        const queue = [[spawn.x, spawn.y]];
        while (queue.length > 0) {
            const [x, y] = queue.shift();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nextX = x + dx;
                const nextY = y + dy;
                const key = `${nextX},${nextY}`;
                if (nextY >= 0 && nextY < state.map.length
                    && nextX >= 0 && nextX < state.map[nextY].length
                    && (state.map[nextY][nextX] === TILE.FLOOR
                        || state.map[nextY][nextX] === TILE.BLOCK)
                    && !visited.has(key)) {
                    visited.add(key);
                    queue.push([nextX, nextY]);
                }
            }
        }
        assert.ok(visited.size >= 20,
            `Spawn (${spawn.x}, ${spawn.y}) should reach multiple open areas`);
    }

    for (let y = 0; y < state.map.length; y += 1) {
        for (let x = 0; x < state.map[y].length; x += 1) {
            if (symbolicMap[y][x] === "X" || symbolicMap[y][x] === "#") {
                assert.equal(state.map[y][x], TILE.WALL);
            }
        }
    }
    assert.ok(state.map.flat().includes(TILE.BLOCK));
});

test("movement validates map boundaries and emits player-moved", () => {
    let state = createInitialState();

    let result = action(state, { type: "move", dx: -1, dy: 0 });
    assert.strictEqual(result.state, state);
    assert.deepEqual(result.events, []);

    result = action(state, { type: "move", dx: 1, dy: 0 });
    assert.deepEqual(result.state.players[0], {
        id: 1,
        name: "Namdo",
        x: 2,
        y: 1,
        alive: true
    });
    assert.deepEqual(result.events, [
        { type: "player-moved", playerId: 1, x: 2, y: 1 }
    ]);
    state = result.state;

    result = action(state, { type: "move", dx: 1, dy: 0 });
    assert.equal(result.state.players[0].x, 3);
    assert.deepEqual(result.events, [
        { type: "player-moved", playerId: 1, x: 3, y: 1 }
    ]);
});

test("bomb placement is serializable and uses an explicit deadline", () => {
    const result = action(createInitialState(), { type: "place-bomb" }, 1000);

    assert.deepEqual(result.state.bombs, [{
        id: 1,
        ownerId: 1,
        x: 1,
        y: 1,
        explodesAt: 4000
    }]);
    assert.deepEqual(result.events, [
        { type: "bomb-placed", bombId: 1, x: 1, y: 1 }
    ]);
});

test("advancing time explodes bombs, destroys blocks, and kills players", () => {
    const state = createInitialState();
    state.map[1][3] = TILE.BLOCK;
    const placed = action(state, { type: "place-bomb" }, 0);
    const result = advanceTime(placed.state, 3000);

    assert.equal(result.state.bombs.length, 0);
    assert.equal(result.state.map[1][3], TILE.FLOOR);
    assert.equal(result.state.players[0].alive, false);
    assert.ok(result.state.explosions.some(cell => cell.x === 1 && cell.y === 1));
    assert.deepEqual(
        result.events.filter(event => event.type === "bomb-exploded"),
        [{ type: "bomb-exploded", bombId: 1, x: 1, y: 1 }]
    );
    assert.deepEqual(
        result.events.filter(event => event.type === "block-destroyed"),
        [
            { type: "block-destroyed", x: 1, y: 3 },
            { type: "block-destroyed", x: 3, y: 1 }
        ]
    );
    assert.deepEqual(
        result.events.filter(event => event.type === "player-killed"),
        [{ type: "player-killed", playerId: 1 }]
    );

    const expired = advanceTime(result.state, 3500);
    assert.deepEqual(expired.state.explosions, []);
});

test("chain reactions explode adjacent bombs and do not leave bomb deadlines", () => {
    let state = createInitialState();
    state.map[1][3] = TILE.FLOOR;
    state.players[0].x = 3;
    state = action(state, { type: "place-bomb" }, 0).state;
    state = action(state, { type: "move", dx: -1, dy: 0 }, 0).state;
    state = action(state, { type: "place-bomb" }, 0).state;

    const result = advanceTime(state, 3000);

    assert.deepEqual(result.state.bombs, []);
    assert.deepEqual(
        result.events.filter(event => event.type === "bomb-exploded").map(event => event.bombId),
        [1, 2]
    );
});

test("reset recreates a complete initial state even after player death", () => {
    const placed = action(createInitialState(), { type: "place-bomb" }, 0);
    const dead = advanceTime(placed.state, 3000).state;
    const result = action(dead, { type: "reset" }, 3500);

    assert.equal(result.state.players[0].alive, true);
    assert.deepEqual(result.state.bombs, []);
    assert.deepEqual(result.state.explosions, []);
    assert.equal(result.state.map[1][3], TILE.FLOOR);
    assert.equal(result.state.nextBombId, 1);
    assert.deepEqual(result.events, [{ type: "game-reset" }]);
});

test("configured initial states support two to four players and string IDs", () => {
    const players = [
        { id: "P1", displayName: "One", x: 1, y: 1 },
        { id: 2, name: "Two", x: 13, y: 1 },
        { id: "P3", displayName: "Three", x: 1, y: 11 },
        { id: "P4", displayName: "Four", x: 13, y: 11 }
    ];

    for (const count of [2, 3, 4]) {
        const state = createInitialState(players.slice(0, count));
        assert.equal(state.players.length, count);
    }
    assert.deepEqual(createInitialState({ players: players.slice(0, 2) }).players, [
        { id: "P1", name: "One", x: 1, y: 1, alive: true },
        { id: 2, name: "Two", x: 13, y: 1, alive: true }
    ]);
});

test("configured players reject invalid IDs, spawns, and duplicates", () => {
    const player = { id: "P1", displayName: "One", x: 1, y: 1 };
    assert.throws(() => createInitialState([player]), RangeError);
    assert.throws(() => createInitialState([
        { id: "", displayName: "One", x: 1, y: 1 },
        { id: "P2", displayName: "Two", x: 13, y: 1 }
    ]), TypeError);
    assert.throws(() => createInitialState([
        player,
        { ...player, displayName: "Two", x: 13, y: 1 }
    ]), RangeError);
    assert.throws(() => createInitialState([
        player,
        { id: "P2", displayName: "Two", x: 1, y: 1 }
    ]), RangeError);
    assert.throws(() => createInitialState([
        player,
        { id: "P2", displayName: "Two", x: 2, y: 4 }
    ]), RangeError);
});

test("initial states do not share mutable data", () => {
    const first = createInitialState();
    const second = createInitialState();
    first.map[1][1] = TILE.BLOCK;
    first.players[0].x = 2;
    assert.equal(second.map[1][1], TILE.FLOOR);
    assert.equal(second.players[0].x, 1);
});

test("living players cannot move into each other but dead players do not block", () => {
    let state = createInitialState([
        { id: 1, name: "One", x: 1, y: 1 },
        { id: 2, name: "Two", x: 2, y: 1 }
    ]);

    let result = applyAction(state, { playerId: 1, type: "move", dx: 1, dy: 0 }, 0);
    assert.strictEqual(result.state, state);

    state.players[1].alive = false;
    result = applyAction(state, { playerId: 1, type: "move", dx: 1, dy: 0 }, 0);
    assert.equal(result.state.players[0].x, 2);
});

test("external elimination preserves the player and rejects unknown or repeated IDs", () => {
    const state = createInitialState([
        { id: "P1", name: "One", x: 1, y: 1 },
        { id: "P2", name: "Two", x: 13, y: 1 }
    ]);
    const eliminated = eliminatePlayer(state, "P1");
    assert.equal(eliminated.state.players[0].alive, false);
    assert.equal(eliminated.state.players.length, 2);
    assert.deepEqual(eliminated.state.result, { type: "win", winnerId: "P2" });
    assert.equal(eliminatePlayer(eliminated.state, "P1").state, eliminated.state);
    assert.equal(eliminatePlayer(state, "unknown").state, state);
});

test("match completion supports explosion deaths, draws, and rejects gameplay", () => {
    const single = createInitialState([
        { id: "P1", name: "One", x: 1, y: 1 },
        { id: "P2", name: "Two", x: 13, y: 1 }
    ]);
    const placed = applyAction(single, { playerId: "P1", type: "place-bomb" }, 0);
    const finished = advanceTime(placed.state, 3000);
    assert.equal(finished.state.status, "finished");
    assert.deepEqual(finished.state.result, { type: "win", winnerId: "P2" });
    assert.strictEqual(
        applyAction(finished.state, { playerId: "P2", type: "move", dx: -1, dy: 0 }, 3000).state,
        finished.state
    );

    const draw = createInitialState([
        { id: "P1", name: "One", x: 1, y: 1 },
        { id: "P2", name: "Two", x: 2, y: 1 }
    ]);
    draw.players[1].x = 1;
    draw.players[1].y = 1;
    const drawPlaced = applyAction(draw, { playerId: "P1", type: "place-bomb" }, 0);
    const drawResult = advanceTime(drawPlaced.state, 3000);
    assert.deepEqual(drawResult.state.result, { type: "draw", winnerId: null });
});

test("reset clears match-specific state and restores configured spawns", () => {
    const initial = createInitialState([
        { id: "P1", name: "One", x: 1, y: 1 },
        { id: "P2", name: "Two", x: 13, y: 1 }
    ]);
    const moved = applyAction(initial, { playerId: "P1", type: "move", dx: 1, dy: 0 }, 0).state;
    const finished = eliminatePlayer(moved, "P1").state;
    const reset = applyAction(finished, { playerId: "P2", type: "reset" }, 0);
    assert.deepEqual(reset.state.players, [
        { id: "P1", name: "One", x: 1, y: 1, alive: true },
        { id: "P2", name: "Two", x: 13, y: 1, alive: true }
    ]);
    assert.equal(reset.state.status, "playing");
    assert.equal(reset.state.result, null);
    assert.deepEqual(reset.state.bombs, []);
    assert.deepEqual(reset.state.explosions, []);
});
