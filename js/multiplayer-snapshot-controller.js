function copy(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(copy);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
}

export function createMultiplayerSnapshotController({ render }) {
    let snapshot = null;
    let active = false;

    function accept(state) {
        if (!state) {
            snapshot = null;
            active = false;
            return null;
        }

        snapshot = copy(state);
        if (state.status === "playing") {
            active = true;
        }

        if (active) {
            render(copy(snapshot));
        }
        return copy(snapshot);
    }

    function finish(state) {
        snapshot = state ? copy(state) : snapshot;
        active = false;
        if (snapshot) {
            render(copy(snapshot));
        }
        return snapshot ? copy(snapshot) : null;
    }

    function leave() {
        snapshot = null;
        active = false;
    }

    return {
        accept,
        finish,
        leave,
        getSnapshot() {
            return snapshot ? copy(snapshot) : null;
        },
        isActive() {
            return active;
        }
    };
}
