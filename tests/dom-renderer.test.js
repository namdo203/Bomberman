import assert from "node:assert/strict";
import { test } from "node:test";
import { createDomRenderer } from "../js/dom-renderer.js";

class FakeClassList {
    constructor() {
        this.values = new Set();
    }
    add(...names) {
        for (const name of names) {
            this.values.add(name);
        }
    }
    remove(...names) {
        for (const name of names) {
            this.values.delete(name);
        }
    }
    contains(name) {
        return this.values.has(name);
    }
    toggle(name, force) {
        if (force === true) {
            this.values.add(name);
            return true;
        }
        if (force === false) {
            this.values.delete(name);
            return false;
        }
        if (this.values.has(name)) {
            this.values.delete(name);
            return false;
        }
        this.values.add(name);
        return true;
    }
    [Symbol.iterator]() {
        return this.values[Symbol.iterator]();
    }
}

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName;
        this.classList = new FakeClassList();
        this.dataset = {};
        this.children = [];
        this.textContent = "";
        this.innerHTML = "";
    }
    append(...children) {
        for (const child of children) {
            this.children.push(child);
        }
    }
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    replaceChildren(...children) {
        this.children = [...children];
    }
    matches(selector) {
        if (selector.startsWith(".")) {
            return this.classList.contains(selector.slice(1));
        }
        return false;
    }
    querySelector(selector) {
        if (selector.startsWith(".tile[data-x=")) {
            const match = selector.match(/data-x="(\d+)"\].*data-y="(\d+)"/);
            if (match) {
                return this.children.find(child =>
                    child.dataset?.x === Number(match[1])
                    && child.dataset?.y === Number(match[2])
                ) || null;
            }
        }
        return null;
    }
    querySelectorAll(selector) {
        if (selector === ".player, .bomb, .explosion") {
            return this.allChildren().filter(child =>
                child.classList.contains("player")
                || child.classList.contains("bomb")
                || child.classList.contains("explosion")
            );
        }
        return [];
    }
    allChildren() {
        const result = [];
        for (const child of this.children) {
            result.push(child);
            result.push(...child.allChildren());
        }
        return result;
    }
}

function createHarness() {
    const board = new FakeElement("div");
    const status = new FakeElement("ul");
    const result = new FakeElement("h2");
    globalThis.document = {
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        querySelector() {
            return null;
        }
    };
    const renderer = createDomRenderer(board, {
        statusElement: status,
        resultElement: result
    });
    return { board, status, result, renderer };
}

test("renders four players with distinct identities and names safely", () => {
    const harness = createHarness();
    harness.renderer.render({
        map: Array.from({ length: 13 }, () => Array(15).fill(0)),
        players: [
            { id: "P1", name: "<b>One</b>", x: 1, y: 1, alive: true },
            { id: "P2", name: "Two", x: 13, y: 1, alive: true },
            { id: "P3", name: "Three", x: 1, y: 11, alive: false },
            { id: "P4", name: "Four", x: 13, y: 11, alive: true }
        ],
        bombs: [],
        explosions: [],
        status: "playing",
        result: null
    });

    const aliveTiles = harness.board.children.filter(tile =>
        tile.classList.contains("player")
    );
    assert.equal(aliveTiles.length, 3);
    assert.equal(aliveTiles.some(tile => tile.classList.contains("player-1")), true);
    assert.equal(aliveTiles.some(tile => tile.classList.contains("player-2")), true);
    assert.equal(aliveTiles.some(tile => tile.classList.contains("player-4")), true);

    const spriteNodes = aliveTiles[0].allChildren()
        .filter(child => child.classList.contains("player-sprite"));
    assert.equal(spriteNodes.length, 1);
   // The player sprite contains SVG markup.
    assert.match(spriteNodes[0].innerHTML, /<svg\b/);
    assert.match(spriteNodes[0].innerHTML, /viewBox="0 0 40 48"/);

    // The first player uses the correct blue palette.
    assert.match(spriteNodes[0].innerHTML, /--sprite-main:\s*#35a7ff/);

    const expectedColors = [
        ["player-1", "#35a7ff"],
        ["player-2", "#ff4d4d"],
        ["player-4", "#ad63ef"]
    ];

    for (const [playerClass, expectedColor] of expectedColors) {
        const tile = aliveTiles.find(element =>
            element.classList.contains(playerClass)
        );

        const sprite = tile.allChildren().find(element =>
            element.classList.contains("player-sprite")
        );

        assert.ok(sprite, `${playerClass} should have a sprite`);
        assert.ok(
            sprite.innerHTML.includes(`--sprite-main: ${expectedColor}`),
            `${playerClass} should use ${expectedColor}`
        );
    }

    const nameNodes = harness.board.children
        .flatMap(tile => tile.children)
        .filter(child => child.classList.contains("player-name"));
    assert.equal(nameNodes.length, 3);
    assert.equal(nameNodes[0].textContent, "<b>One</b>");
    assert.equal(nameNodes[0].children.length, 0);

    assert.equal(harness.status.children.length, 4);
    assert.equal(harness.status.children[0].children[0].textContent, "<b>One</b>");
    assert.equal(harness.status.children[2].classList.contains("eliminated"), true);
    assert.equal(harness.status.children[2].children[1].textContent, "Eliminated");
});

test("eliminated players do not occupy board tiles", () => {
    const harness = createHarness();
    harness.renderer.render({
        map: [[0, 0], [0, 0]],
        players: [{ id: 1, name: "One", x: 1, y: 1, alive: false }],
        bombs: [],
        explosions: [],
        status: "playing",
        result: null
    });

    assert.equal(harness.board.children.some(tile => tile.classList.contains("player")), false);
    assert.equal(harness.status.children[0].children[1].textContent, "Eliminated");
});

test("renders authoritative bombs and explosions", () => {
    const harness = createHarness();
    harness.renderer.render({
        map: [[0, 0], [0, 0]],
        players: [],
        bombs: [{ id: 1, x: 0, y: 0 }],
        explosions: [{ x: 1, y: 0 }],
        status: "playing",
        result: null
    });

    const bombTile = harness.board.children.find(tile => tile.dataset.x === 0 && tile.dataset.y === 0);
    const explosionTile = harness.board.children.find(tile => tile.dataset.x === 1 && tile.dataset.y === 0);
    assert.equal(bombTile.classList.contains("bomb"), true);
    assert.equal(explosionTile.classList.contains("explosion"), true);
});

test("retains and displays a final win or draw snapshot", () => {
    const harness = createHarness();
    harness.renderer.render({
        map: [[0]],
        players: [
            { id: "P1", name: "One", x: 0, y: 0, alive: false },
            { id: "P2", name: "Two", x: 0, y: 0, alive: true }
        ],
        bombs: [],
        explosions: [],
        status: "finished",
        result: { type: "win", winnerId: "P2" }
    });
    assert.equal(harness.result.textContent, "Two wins!");

    harness.renderer.render({
        map: [[0]],
        players: [
            { id: "P1", name: "One", x: 0, y: 0, alive: false },
            { id: "P2", name: "Two", x: 0, y: 0, alive: false }
        ],
        bombs: [],
        explosions: [],
        status: "finished",
        result: { type: "draw", winnerId: null }
    });
    assert.equal(harness.result.textContent, "Draw");
});
