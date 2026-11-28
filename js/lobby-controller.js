export function normalizeDisplayName(value) {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizeRoomId(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidDisplayName(value) {
    const length = normalizeDisplayName(value).length;
    return length >= 2 && length <= 16;
}

export function isValidRoomId(value) {
    return /^[A-Z0-9]{6}$/.test(normalizeRoomId(value));
}

export function isStartEligible(room) {
    if (!room || room.status !== "waiting") {
        return false;
    }
    const eligibleCount = Array.isArray(room.players)
        ? room.players.filter(player => player.status === "connected"
            && player.connected !== false).length
        : 0;
    return eligibleCount >= 2 && eligibleCount <= 4;
}

export function formatRejection(rejection) {
    const error = rejection?.error;
    if (!error) {
        return "The server rejected the request.";
    }
    return error.message || error.code || "The server rejected the request.";
}

export function createLobbyController({
    elements,
    networkSession,
    onLeave,
    onLeaveRequest
}) {
    function setMessage(message = "") {
        elements.message.textContent = message;
    }

    function clearRoom() {
        elements.roomId.textContent = "Not in a room";
        elements.roomStatus.textContent = "Waiting for a room";
        elements.playerList.replaceChildren();
        elements.leaveButton.disabled = true;
        elements.startButton.disabled = true;
        elements.createButton.disabled = false;
        elements.joinButton.disabled = false;
    }

    function renderRoom(room) {
        if (!room) {
            clearRoom();
            return;
        }

        elements.roomId.textContent = room.roomId || "Unknown";
        elements.roomStatus.textContent = room.status || "unknown";
        elements.playerList.replaceChildren();
        for (const player of Array.isArray(room.players) ? room.players : []) {
            const item = document.createElement("li");
            const connected = player.status === "connected" && player.connected !== false;
            item.textContent = `${player.displayName || "Unknown"} (${connected ? "connected" : "left"})`;
            elements.playerList.append(item);
        }

        const participating = Boolean(networkSession.getRoom());
        elements.leaveButton.disabled = !participating;
        elements.createButton.disabled = participating;
        elements.joinButton.disabled = participating;
        elements.startButton.disabled = !participating || !isStartEligible(room);
    }

    function createRoom() {
        const displayName = normalizeDisplayName(elements.displayName.value);
        if (!isValidDisplayName(displayName)) {
            setMessage("Display name must contain 2 to 16 characters.");
            return;
        }
        if (networkSession.getRoom()) {
            setMessage("You are already participating in a room.");
            return;
        }
        setMessage("Creating room...");
        networkSession.createRoom(displayName);
    }

    function joinRoom() {
        const displayName = normalizeDisplayName(elements.displayName.value);
        const roomId = normalizeRoomId(elements.roomIdInput.value).toUpperCase();
        if (!isValidDisplayName(displayName)) {
            setMessage("Display name must contain 2 to 16 characters.");
            return;
        }
        if (!isValidRoomId(roomId)) {
            setMessage("Room ID must contain exactly 6 uppercase letters or numbers.");
            return;
        }
        if (networkSession.getRoom()) {
            setMessage("You are already participating in a room.");
            return;
        }
        elements.roomIdInput.value = roomId;
        setMessage("Joining room...");
        networkSession.joinRoom(roomId, displayName);
    }

    function leaveRoom() {
        if (!networkSession.getRoom()) {
            clearRoom();
            setMessage("You are not in a room.");
            return;
        }
        setMessage("Leaving room...");
        const completeLeave = (acknowledgment) => {
            if (acknowledgment?.ok === false) {
                setMessage(formatRejection(acknowledgment));
                return;
            }
            clearRoom();
            setMessage("Left the room.");
            if (typeof onLeave === "function") {
                onLeave();
            }
        };
        if (typeof onLeaveRequest === "function") {
            onLeaveRequest(completeLeave);
        } else {
            networkSession.leave(completeLeave);
        }
    }

    elements.createButton.addEventListener("click", createRoom);
    elements.joinButton.addEventListener("click", joinRoom);
    elements.startButton.addEventListener("click", () => {
        const room = networkSession.getRoom();
        if (!isStartEligible(room)) {
            setMessage("The room needs at least 2 connected players and must be waiting.");
            return;
        }
        setMessage("Starting game...");
        networkSession.startRoom();
    });
    elements.leaveButton.addEventListener("click", leaveRoom);

    return {
        setMessage,
        clearRoom,
        renderRoom
    };
}
