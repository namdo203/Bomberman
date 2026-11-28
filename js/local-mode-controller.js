export function createLocalModeController({
    createSession,
    attachInput,
    onStateChange,
    render
}) {
    let session = null;
    let detachInput = null;
    let active = false;

    function ensureStarted() {
        if (!session) {
            session = createSession({
                onStateChange(state, events) {
                    onStateChange(state, events);
                }
            });
            render(session.getState());
        } else {
            render(session.getState());
        }

        if (detachInput === null) {
            detachInput = attachInput(action => session.dispatch(action));
        }
        if (!active) {
            session.start();
            active = true;
        }
    }

    function stop() {
        if (detachInput !== null) {
            detachInput();
            detachInput = null;
        }
        if (session && active) {
            session.stop();
            active = false;
        }
    }

    return {
        ensureStarted,
        stop,
        getSession() {
            return session;
        },
        isActive() {
            return active;
        }
    };
}
