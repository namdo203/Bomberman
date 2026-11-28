import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("HTML entry point references existing local assets", () => {
    const html = readFileSync(path.join(projectRoot, "index.html"), "utf8");
    const assetPaths = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)]
        .map(([, assetPath]) => assetPath)
        .filter((assetPath) => !/^(?:[a-z]+:)?\/\//i.test(assetPath) && !assetPath.startsWith("#"));

    assert.deepEqual(assetPaths, [
        "css/style.css",
        "/socket.io/socket.io.js",
        "js/main.js"
    ]);
    for (const assetPath of assetPaths) {
        if (assetPath.startsWith("/socket.io/")) {
            continue;
        }
        assert.ok(existsSync(path.join(projectRoot, assetPath)));
    }
});

test("entry point separates lobby controls and initializes a shared socket once", () => {
    const html = readFileSync(path.join(projectRoot, "index.html"), "utf8");
    const main = readFileSync(path.join(projectRoot, "js/main.js"), "utf8");

    for (const id of [
        "display-name",
        "create-room-button",
        "room-id",
        "join-room-button",
        "current-room-id",
        "player-list",
        "start-game-button",
        "leave-room-button",
        "lobby-message",
        "game-area",
        "game-status",
        "match-result",
        "player-status-list",
        "play-again-button",
        "game-leave-room-button"
    ]) {
        assert.match(html, new RegExp(`id="${id}"`));
    }

    assert.equal((main.match(/window\.io\(\)/g) || []).length, 1);
    assert.match(main, /createNetworkSession\(\{/);
    assert.match(main, /createLocalModeController/);
    assert.match(main, /localMode\.stop\(\)/);
    assert.match(main, /localMode\.ensureStarted\(\)/);
    assert.match(main, /toMultiplayerAction/);
    assert.match(main, /activateMultiplayerInput/);
    assert.match(main, /stopMultiplayerInput/);
    assert.match(main, /createMultiplayerSnapshotController/);
    assert.match(main, /multiplayerSnapshot\.leave\(\)/);
});
