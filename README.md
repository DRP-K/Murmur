# Social App

An offline-first social app with E2E encrypted messaging and an anonymous feed. Built with Tauri 2 (Rust + React).

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) (system WebView, etc.) — only needed for the desktop app

```bash
npm install
```

---

## Web app (browser)

Runs entirely in the browser — no Tauri or Rust required. Uses IndexedDB for local storage and connects to the relay server over HTTP/WebSocket.

```bash
npm run dev
# → http://localhost:1420
```

The dev server proxies `/api` to `http://127.0.0.1:8080`, so start the relay server first (see below).

To build for production:

```bash
npm run build    # output in dist/
npm run preview  # serve the built output locally
```

---

## Desktop app (Tauri)

Bundles the React frontend with a Rust backend and native SQLite storage.

```bash
npm run tauri dev
```

Override the relay server URL:

```bash
RELAY_URL=http://localhost:9090 npm run tauri dev
```

Build a release binary:

```bash
npm run tauri build
```

---

## Relay server

Standalone Axum server that queues messages and fan-outs posts for offline users.

```bash
cd server
cargo run --release
# → http://127.0.0.1:8080
```

Environment variables (all optional):

| Variable   | Default | Description                                          |
|------------|---------|------------------------------------------------------|
| `PORT`     | `8080`  | Port to listen on                                    |
| `DATA_DIR` | `.`     | Directory where `server.db` is written (must exist)  |

```bash
PORT=9090 DATA_DIR=/var/data cargo run --release
```
