import { createDomRenderer } from "./dom-renderer.js";
import { attachInputController, toMultiplayerAction } from "./input-controller.js";
import { createLocalSession } from "./local-session.js";
import { createNetworkSession } from "./network-session.js";
import { createLobbyController, formatRejection } from "./lobby-controller.js";
import { createLocalModeController } from "./local-mode-controller.js";
import { createMultiplayerSnapshotController } from "./multiplayer-snapshot-controller.js";

const gameElement = document.querySelector("#game");
const gameArea = document.querySelector("#game-area");
const connectionStatus = document.querySelector("#connection-status");
const playAgainButton = document.querySelector("#play-again-button");
const gameLeaveRoomButton = document.querySelector("#game-leave-room-button");
let resetPending = false;
let activeMode = "local";
const renderer = createDomRenderer(gameElement, {
    statusElement: document.querySelector("#player-status-list"),
    resultElement: document.querySelector("#match-result")
});
let multiplayerDetach = null;

const multiplayerSnapshot = createMultiplayerSnapshotController({
    render: state => {
        renderer.render(state);
        playAgainButton.hidden = state.status !== "finished";
        gameLeaveRoomButton.hidden = activeMode !== "multiplayer";
        if (state.status === "playing") {
            resetPending = false;
            playAgainButton.disabled = false;
        }
    }
});

const localMode = createLocalModeController({
    createSession: options => createLocalSession({
        ...options,
        onStateChange: options.onStateChange
    }),
    attachInput: dispatch => attachInputController({ dispatch }),
    onStateChange: (state) => {
        renderer.render(state);
        if (activeMode === "local") {
            playAgainButton.hidden = state.status !== "finished";
            gameLeaveRoomButton.hidden = true;
        }
    },
    render: state => renderer.render(state)
});

function stopMultiplayerInput() {
    if (multiplayerDetach) {
        multiplayerDetach();
        multiplayerDetach = null;
    }
}

function activateMultiplayerInput() {
    if (multiplayerDetach) {
        return;
    }
    localMode.stop();
    activeMode = "multiplayer";
    document.querySelector("#lobby").hidden = true;
    gameArea.hidden = false;
    gameLeaveRoomButton.hidden = false;
    playAgainButton.hidden = multiplayerSnapshot.getSnapshot()?.status !== "finished";
    multiplayerDetach = attachInputController({
        dispatch: action => networkSession.dispatch(action),
        actionMapper: toMultiplayerAction
    });
}

function startLocalMode() {
    stopMultiplayerInput();
    activeMode = "local";
    document.querySelector("#lobby").hidden = true;
    gameArea.hidden = false;
    gameLeaveRoomButton.hidden = true;
    localMode.ensureStarted();
}

function showLobby() {
    stopMultiplayerInput();
    multiplayerSnapshot.leave();
    localMode.stop();
    activeMode = "lobby";
    resetPending = false;
    playAgainButton.hidden = true;
    playAgainButton.disabled = false;
    gameLeaveRoomButton.hidden = true;
    gameArea.hidden = true;
    document.querySelector("#lobby").hidden = false;
}

function leaveMultiplayer(onSuccess) {
    if (!networkSession.getRoom()) {
        stopMultiplayerInput();
        multiplayerSnapshot.leave();
        lobby.clearRoom();
        if (typeof onSuccess === "function") {
            onSuccess();
        }
        return;
    }

    lobby.setMessage("Leaving room...");
    networkSession.leave((acknowledgment) => {
        if (acknowledgment?.ok === false) {
            lobby.setMessage(formatRejection(acknowledgment));
            if (activeMode === "multiplayer") {
                document.querySelector("#match-result").textContent =
                    `Leave failed: ${formatRejection(acknowledgment)}`;
            }
            resetPending = false;
            playAgainButton.disabled = false;
            return;
        }
        stopMultiplayerInput();
        multiplayerSnapshot.leave();
        lobby.clearRoom();
        lobby.setMessage("Left the room.");
        if (typeof onSuccess === "function") {
            onSuccess();
        }
    });
}

function enterLobby() {
    if (networkSession.getRoom()) {
        leaveMultiplayer(showLobby);
        return;
    }
    showLobby();
}

const lobbyElements = {
    displayName: document.querySelector("#display-name"),
    roomIdInput: document.querySelector("#room-id"),
    createButton: document.querySelector("#create-room-button"),
    joinButton: document.querySelector("#join-room-button"),
    roomId: document.querySelector("#current-room-id"),
    roomStatus: document.querySelector("#room-status"),
    playerList: document.querySelector("#player-list"),
    startButton: document.querySelector("#start-game-button"),
    leaveButton: document.querySelector("#leave-room-button"),
    message: document.querySelector("#lobby-message")
};

const socket = window.io();

const networkSession = createNetworkSession({
    socket,
    onStateChange(state) {
        if (!state) {
            multiplayerSnapshot.leave();
            return;
        }
        if (state.status === "finished") {
            multiplayerSnapshot.finish(state);
            stopMultiplayerInput();
        } else {
            multiplayerSnapshot.accept(state);
            if (state.status === "playing") {
                activateMultiplayerInput();
            }
        }
    },
    onRoomChange(room) {
        lobby.renderRoom(room);
        if (room) {
            lobby.setMessage(room.status === "playing"
                ? "Game started."
                : "Room updated.");
        }
    },
    onRequestError(rejection) {
        lobby.setMessage(formatRejection(rejection));
        if (rejection?.requestEvent === "game:reset-request") {
            resetPending = false;
            playAgainButton.disabled = false;
            if (rejection?.error?.code === "INSUFFICIENT_ELIGIBLE_PLAYERS") {
                document.querySelector("#match-result").textContent =
                    "Replay unavailable: 2 connected players are required";
            }
        }
    },
    onEvent(event) {
        if (event?.type === "game:started") {
            activateMultiplayerInput();
        } else if (event?.type === "game:finished") {
            stopMultiplayerInput();
        }
    }
});

const lobby = createLobbyController({
    elements: lobbyElements,
    networkSession,
    onLeave: enterLobby,
    onLeaveRequest: leaveMultiplayer
});

document.querySelector("#local-mode-button").addEventListener("click", () => {
    if (networkSession.getRoom()) {
        leaveMultiplayer(startLocalMode);
        return;
    }
    startLocalMode();
});

document.querySelector("#multiplayer-mode-button").addEventListener("click", enterLobby);

playAgainButton.addEventListener("click", () => {
    if (resetPending) {
        return;
    }
    if (activeMode === "local") {
        const state = localMode.getSession()?.getState();
        if (state?.status === "finished") {
            localMode.getSession().dispatch({ type: "reset", playerId: 1 });
            playAgainButton.hidden = true;
        }
        return;
    }
    if (activeMode !== "multiplayer"
        || multiplayerSnapshot.getSnapshot()?.status !== "finished") {
        return;
    }
    resetPending = true;
    playAgainButton.disabled = true;
    lobby.setMessage("Resetting match...");
    networkSession.reset();
});

gameLeaveRoomButton.addEventListener("click", () => {
    leaveMultiplayer(showLobby);
});

socket.on("connect", () => {
    connectionStatus.textContent = "Connected to server";
});

socket.on("disconnect", () => {
    connectionStatus.textContent = "Disconnected from server. Reconnecting...";
});

startLocalMode();
