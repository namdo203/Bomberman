const KEY_ACTIONS = new Map([
    ["ArrowUp", { type: "move", dx: 0, dy: -1 }],
    ["ArrowDown", { type: "move", dx: 0, dy: 1 }],
    ["ArrowLeft", { type: "move", dx: -1, dy: 0 }],
    ["ArrowRight", { type: "move", dx: 1, dy: 0 }],
    [" ", { type: "place-bomb" }],
    ["r", { type: "reset" }]
]);

export function toMultiplayerAction(action) {
    if (action?.type === "place-bomb") {
        return { type: "place-bomb" };
    }
    if (action?.type === "move" && action.direction) {
        return { type: "move", direction: action.direction };
    }
    if (action && action.dx !== undefined && action.dy !== undefined) {
        if (action.dx === 0 && action.dy === -1) {
            return { type: "move", direction: "up" };
        }
        if (action.dx === 0 && action.dy === 1) {
            return { type: "move", direction: "down" };
        }
        if (action.dx === -1 && action.dy === 0) {
            return { type: "move", direction: "left" };
        }
        if (action.dx === 1 && action.dy === 0) {
            return { type: "move", direction: "right" };
        }
    }
    return null;
}

export function attachInputController({
    target = document,
    dispatch,
    playerId = 1,
    actionMapper = action => action
} = {}) {
    let walkingTimer = null;

    function updatePlayerVisual(action) {
        if (typeof document === "undefined") {
            return;
        }
        let direction = null;
        if (action.dy === -1) direction = "up";
        if (action.dy === 1) direction = "down";
        if (action.dx === -1) direction = "left";
        if (action.dx === 1) direction = "right";
        if (!direction) return;

        const playerTile = document.querySelector(`.player.player-${playerId}`);
        if (!playerTile) return;
        for (const name of ["up", "down", "left", "right"]) {
            playerTile.classList.remove(`facing-${name}`);
        }
        playerTile.classList.add(`facing-${direction}`, "walking");
        if (walkingTimer !== null) clearTimeout(walkingTimer);
        walkingTimer = setTimeout(() => {
            playerTile.classList.remove("walking");
            walkingTimer = null;
        }, 160);
    }

    function onKeyDown(event) {
        const action = KEY_ACTIONS.get(event.key);
        if (!action) {
            return;
        }

        event.preventDefault();
        updatePlayerVisual(action);
        const mappedAction = actionMapper({ ...action, playerId });
        if (mappedAction) {
            dispatch(mappedAction);
        }
    }

    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
}
