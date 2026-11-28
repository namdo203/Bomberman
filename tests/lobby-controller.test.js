import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createLobbyController,
    formatRejection,
    isStartEligible,
    isValidDisplayName,
    isValidRoomId,
    normalizeRoomId
} from "../js/lobby-controller.js";

test("validates lobby display names and room IDs", () => {
    assert.equal(isValidDisplayName("  Player  "), true);
    assert.equal(isValidDisplayName("A"), false);
    assert.equal(normalizeRoomId(" ab12cd "), "AB12CD");
    assert.equal(isValidRoomId("ab12cd"), true);
    assert.equal(isValidRoomId("SHORT"), false);
});

test("start eligibility requires waiting status and 2 to 4 connected players", () => {
    assert.equal(isStartEligible({
        status: "waiting",
        players: [
            { status: "connected", connected: true },
            { status: "connected", connected: true }
        ]
    }), true);
    assert.equal(isStartEligible({
        status: "waiting",
        players: [{ status: "connected", connected: true }]
    }), false);
    assert.equal(isStartEligible({
        status: "playing",
        players: [
            { status: "connected", connected: true },
            { status: "connected", connected: true }
        ]
    }), false);
});

test("formats server request rejections", () => {
    assert.equal(formatRejection({
        error: { code: "ROOM_NOT_READY", message: "Room requires at least 2 connected players." }
    }), "Room requires at least 2 connected players.");
    assert.equal(formatRejection({}), "The server rejected the request.");
});

test("leaving a room clears lobby state and reports mode exit", () => {
    function button() {
        return {
            disabled: false,
            listener: null,
            addEventListener(eventName, listener) {
                this.listener = listener;
            }
        };
    }
    const elements = {
        displayName: { value: "Player" },
        roomIdInput: { value: "ABC123" },
        createButton: button(),
        joinButton: button(),
        roomId: { textContent: "ABC123" },
        roomStatus: { textContent: "playing" },
        playerList: { replaceChildren() {} },
        startButton: button(),
        leaveButton: button(),
        message: { textContent: "" }
    };
    let left = false;
    let leaveCount = 0;
    const networkSession = {
        getRoom() {
            return { roomId: "ABC123", status: "waiting", players: [] };
        },
        leave(callback) {
            leaveCount += 1;
            if (typeof callback === "function") {
                callback({ ok: true });
            }
        }
    };

    createLobbyController({
        elements,
        networkSession,
        onLeave() {
            left = true;
        }
    });
    elements.leaveButton.listener();

    assert.equal(leaveCount, 1);
    assert.equal(left, true);
    assert.equal(elements.roomId.textContent, "Not in a room");
    assert.equal(elements.leaveButton.disabled, true);
});

test("leave failure leaves room state intact and does not report mode exit", () => {
    function button() {
        return {
            disabled: false,
            listener: null,
            addEventListener(eventName, listener) {
                this.listener = listener;
            }
        };
    }
    const elements = {
        displayName: { value: "Player" },
        roomIdInput: { value: "ABC123" },
        createButton: button(),
        joinButton: button(),
        roomId: { textContent: "ABC123" },
        roomStatus: { textContent: "playing" },
        playerList: { replaceChildren() {} },
        startButton: button(),
        leaveButton: button(),
        message: { textContent: "" }
    };
    let modeExitCount = 0;
    let leaveCount = 0;
    const networkSession = {
        getRoom() {
            return { roomId: "ABC123", status: "playing", players: [] };
        },
        leave(callback) {
            leaveCount += 1;
            callback({ ok: false, error: { message: "Leave failed." } });
        }
    };
    createLobbyController({
        elements,
        networkSession,
        onLeave() {
            modeExitCount += 1;
        }
    });

    elements.leaveButton.listener();

    assert.equal(leaveCount, 1);
    assert.equal(modeExitCount, 0);
    assert.equal(elements.roomId.textContent, "ABC123");
    assert.equal(elements.leaveButton.disabled, false);
    assert.equal(elements.message.textContent, "Leave failed.");
});
