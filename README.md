# Bomberman MVP

Bomberman MVP is a browser-based grid game built as a university portfolio project. The goal is to remain alive while using bombs to destroy destructible blocks and eliminate the other players.

The application provides two modes:

- **Local mode**: a one-player session run in the browser. This is not same-device local multiplayer.
- **Network multiplayer**: 2–4 players join a server-managed room over Socket.IO.

The server validates multiplayer requests and owns the authoritative match state. Explosions, eliminations, and match results are sent to clients as snapshots.

## Features

The implemented features are:

- One-player local gameplay with reset/replay support.
- Multiplayer rooms identified by a six-character room ID.
- Display names containing 2–16 characters.
- 2–4 connected multiplayer participants per match.
- Arrow-key movement and bomb placement.
- Bomb countdowns, explosions, chain reactions, and destructible blocks.
- Player elimination, winner results, and draw results.
- Match replay after a multiplayer match finishes.
- Explicit room leaving and automatic elimination on Socket.IO disconnect.
- Lobby and game views with player connection/status information.

## Technologies

| Area | Technology |
| --- | --- |
| Page structure | HTML5 |
| Styling | CSS |
| Client logic | Vanilla JavaScript |
| Client modules | Native browser ES modules |
| Server | Node.js built-in HTTP server |
| Realtime multiplayer | Socket.IO |
| Tests | Node.js built-in `node:test` runner |

Project dependencies:

- `socket.io` — server and browser Socket.IO integration.
- `socket.io-client` — development dependency used by server and room integration tests.

No frontend framework is used.

## Requirements and installation

### Requirements

- Node.js 20 or later
- npm
- A modern browser with JavaScript and ES module support

Node.js 20 or later is the recommended project requirement. The project uses the native test runner and ES module configuration.

### Clone and install

```sh
git clone https://github.com/namdo203/Bomberman.git
cd Bomberman
npm install
```

### Environment configuration

There is no required environment file or secret configuration. The server reads an optional `PORT` environment variable.

## Running the application

Start the server from the repository root:

```sh
npm start
```

The server listens on port `8080` by default. To use another port:

```sh
PORT=3000 npm start
```

On Windows PowerShell, set the variable and start in the same shell:

```powershell
$env:PORT = "3000"
npm start
```

Open the application in a browser at:

```text
http://localhost:8080
```

If you override `PORT`, use that port in the URL instead.

### Access from another device

Devices must be able to reach the host computer over the same LAN.

1. Start the server on the host computer.
2. Find the host computer's IPv4 LAN address, for example `ipconfig` on Windows.
3. Open `http://<host-ip>:8080` on the other device.
4. If Windows Firewall blocks the connection, allow Node.js or the local server port on the host network and retry.

## How to play

The game board is 13 rows by 15 columns.

### Local mode

1. Open the application.
2. Select **Local Game**.
3. Move and place bombs with the keyboard.
4. Press **R** or use **Play again** after the local match finishes to reset the board.

### Multiplayer mode

1. Open the application and select **Multiplayer Lobby**.
2. Enter a display name containing 2–16 characters.
3. One player selects **Create Room** to generate a six-character room ID.
4. Each other player enters that room ID and selects **Join Room**.
5. When 2–4 connected players are present, any room member can select **Start Game**.
6. Use the keyboard controls to play. Eliminated players cannot act.
7. After the match finishes, a connected eligible player can select **Play again** to replay.
8. Select **Leave Room** to leave. In a waiting room, leaving removes that player. During a match, leaving eliminates that player and the room updates the remaining participants.

If fewer than two players remain eligible to replay, the server rejects the replay request.

## Controls

| Key | Action |
| --- | --- |
| Arrow Up | Move up |
| Arrow Down | Move down |
| Arrow Left | Move left |
| Arrow Right | Move right |
| Space | Place a bomb |
| R | Reset the local match |

`R` is handled by the local session. Multiplayer replay is initiated by the **Play again** button.

## Architecture

The project separates game rules from browser and network adapters.

- **Game Core**: `js/game-state.js` and `js/game-rules.js` store and update the map, players, bombs, explosions, and match result. They are shared by local and multiplayer sessions.
- **LocalSession**: `js/local-session.js` runs the one-player browser game and owns its 50 ms time updates.
- **NetworkSession**: `js/network-session.js` sends validated player actions to Socket.IO and accepts server snapshots.
- **RoomManager**: `server/room-manager.js` manages room membership, display names, room IDs, the 2–4 player start requirement, leaves, and disconnects.
- **GameSession**: `server/game-session.js` owns multiplayer match timing and produces authoritative server snapshots.
- **Socket.IO communication**: the browser uses room, game, and rejection events from `js/protocol.js` while the server validates and broadcasts them.
- **Server-authoritative snapshots**: multiplayer clients render snapshots containing the map, players, bombs, explosions, status, result, revision, and game epoch.

The HTTP server and Socket.IO endpoint are implemented by `server/dev-server.js`. It also serves the static HTML, CSS, JavaScript modules, and Socket.IO client script.

## Project structure

```text
Bomberman/
├── css/
│   └── style.css
├── js/
│   ├── dom-renderer.js
│   ├── game-rules.js
│   ├── game-state.js
│   ├── input-controller.js
│   ├── local-mode-controller.js
│   ├── local-session.js
│   ├── lobby-controller.js
│   ├── main.js
│   ├── multiplayer-snapshot-controller.js
│   ├── network-session.js
│   └── protocol.js
├── server/
│   ├── dev-server.js
│   ├── game-session.js
│   └── room-manager.js
├── tests/
│   ├── dom-renderer.test.js
│   ├── entrypoint.test.js
│   ├── game-session-server.test.js
│   ├── game-session.test.js
│   ├── game.test.js
│   ├── input-controller.test.js
│   ├── lobby-controller.test.js
│   ├── local-mode-controller.test.js
│   ├── multiplayer-snapshot-controller.test.js
│   ├── network-session.test.js
│   ├── protocol.test.js
│   ├── room-manager.test.js
│   └── server.test.js
├── index.html
├── package.json
└── package-lock.json
```

## Testing and validation

Run commands from the repository root.

| Command | Purpose |
| --- | --- |
| `npm run check` | Runs `check:js`, which syntax-checks the application JavaScript modules and server files. |
| `npm run check:js` | Runs the individual `node --check` syntax checks directly. |
| `npm test` | Runs the Node.js built-in test suite in `tests/`. |
| `npm run validate` | Runs `npm run check` followed by `npm test`. |

Example:

```sh
npm run validate
```

The automated suite covers the Game Core, local session behavior, input mapping, lobby and network sessions, room lifecycle, server protocol, snapshots, and HTTP/Socket.IO server behavior. It does not provide browser end-to-end coverage or automate visual browser rendering.

## Current limitations

- The local mode is a one-player session; same-device local multiplayer is not implemented.
- Multiplayer rooms support 2–4 players and require at least two connected players to start.
- Disconnection eliminates the player from a playing match; reconnecting to the same player identity is not implemented.
- Playing rooms are retained after players disconnect or leave; there is no room expiration or automatic post-match deletion.
- Replay requires at least two currently connected eligible players.
- There is no browser end-to-end test suite.
