import {createPlayerSprite} from "./player-sprite.js";

export function createDomRenderer(gameElement, options = {}) {
    const statusElement = options.statusElement
        || (typeof document !== "undefined" ? document.querySelector("#player-status-list") : null);
    const resultElement = options.resultElement
        || (typeof document !== "undefined" ? document.querySelector("#match-result") : null);

    function getIdentityIndex(player, index) {
        if (typeof player.id === "number" && Number.isSafeInteger(player.id)) {
            return ((player.id - 1) % 4 + 4) % 4;
        }
        return index % 4;
    }

    function getPlayerName(player) {
        const name = player?.name ?? player?.displayName;
        return typeof name === "string" && name.trim().length > 0
            ? name.trim()
            : "Unknown";
    }

    function renderMap(state) {
        if (typeof gameElement.replaceChildren === "function") {
            gameElement.replaceChildren();
        } else {
            gameElement.innerHTML = "";
        }
        for (let y = 0; y < state.map.length; y++) {
            for (let x = 0; x < state.map[y].length; x++) {
                const tile = document.createElement("div");
                tile.classList.add("tile");
                tile.dataset.x = x;
                tile.dataset.y = y;
                tile.classList.add(
                    state.map[y][x] === 1 ? "wall"
                        : state.map[y][x] === 2 ? "block"
                            : "floor"
                );
                gameElement.appendChild(tile);
            }
        }
    }

    function renderEntities(state) {
        for (const tile of gameElement.querySelectorAll(".player, .bomb, .explosion")) {
            tile.classList.remove("player", "bomb", "explosion");
            for (const className of [...tile.classList]) {
                if (className.startsWith("player-")) {
                    tile.classList.remove(className);
                }
                if (className.startsWith("facing-") || className === "walking") {
                    tile.classList.remove(className);
                }
            }
            if (typeof tile.replaceChildren === "function") {
                tile.replaceChildren();
            } else {
                tile.innerHTML = "";
            }
        }

        for (const [index, player] of (Array.isArray(state.players) ? state.players : []).entries()) {
            if (player.alive) {
                const tile = getTile(player.x, player.y);
                if (!tile) {
                    continue;
                }
                const identityIndex = getIdentityIndex(player, index);
                tile.classList.add("player", `player-${identityIndex + 1}`);
                const sprite = createPlayerSprite(identityIndex);

                const nameBadge = document.createElement("span");
                nameBadge.classList.add("player-name");
                nameBadge.textContent = getPlayerName(player);

                tile.append(sprite, nameBadge);
            }
        }
        for (const bomb of state.bombs) {
            getTile(bomb.x, bomb.y)?.classList.add("bomb");
        }
        for (const explosion of state.explosions) {
            getTile(explosion.x, explosion.y)?.classList.add("explosion");
        }
    }

    function renderStatus(state) {
        if (statusElement) {
            if (typeof statusElement.replaceChildren === "function") {
                statusElement.replaceChildren();
            } else {
                statusElement.innerHTML = "";
            }
            for (const [index, player] of (Array.isArray(state.players) ? state.players : []).entries()) {
                const item = document.createElement("li");
                const identityIndex = getIdentityIndex(player, index);
                item.classList.add("status-player", `status-player-${identityIndex + 1}`);
                item.classList.toggle("eliminated", player.alive === false);

                const name = document.createElement("span");
                name.classList.add("status-name");
                name.textContent = getPlayerName(player);

                const status = document.createElement("span");
                status.classList.add("status-value");
                status.textContent = player.alive ? "Alive" : "Eliminated";

                item.append(name, status);
                statusElement.appendChild(item);
            }
        }

        if (resultElement) {
            if (state.status === "finished") {
                if (state.result?.type === "win") {
                    const winner = (state.players || []).find(player => player.id === state.result.winnerId);
                    resultElement.textContent = winner
                        ? `${getPlayerName(winner)} wins!`
                        : "Match finished";
                } else if (state.result?.type === "draw") {
                    resultElement.textContent = "Draw";
                } else {
                    resultElement.textContent = "Match finished";
                }
            } else {
                resultElement.textContent = "Match in progress";
            }
        }
    }

    function getTile(x, y) {
        return gameElement.querySelector(`.tile[data-x="${x}"][data-y="${y}"]`);
    }

    return {
        render(state) {
            renderMap(state);
            renderEntities(state);
            renderStatus(state);
        }
    };
}
