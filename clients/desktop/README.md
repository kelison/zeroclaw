# ZeroClaw Desktop

Tauri v2 desktop shell for the local `tauri` channel.

## Included

- connects to `ws://127.0.0.1:7703`
- renders `stream_chunk`, `stream_end`, `text`, and `notify`
- persists local chat history in SQLite via Tauri backend
- browses a selected workspace and previews text files
- supports multi-session history, rename, delete, search, and auto-titled sessions
- stays resident in the system tray and supports creating a new session from the tray
- shows actionable notifications that can reopen the desktop window
- renders code, tables, images, and files, including CSV export and file reveal

## Prerequisites

- Node.js 20+
- Rust toolchain compatible with Tauri v2
- WebView runtime for your OS
- a running ZeroClaw process with the `tauri` channel enabled

## Configure ZeroClaw

Before starting the desktop app, configure and start ZeroClaw with:

```toml
[channels_config.tauri]
port = 7703
workspace = "C:/absolute/workspace"
allowed_users = ["local"]
```

The desktop app expects the local channel at `ws://127.0.0.1:7703`.

## Dev Run

```bash
cd clients/desktop
npm install
npm run tauri dev
```

## Production Build

```bash
cd clients/desktop
npm install
npm run tauri build
```

On Windows this produces installer/bundle artifacts under:

```text
clients/desktop/src-tauri/target/release/bundle/
```

## Usage Notes

- Close hides the window to tray instead of exiting.
- The tray menu includes `Show Window`, `Hide Window`, `New Session`, and `Quit`.
- If ZeroClaw is not running yet, the desktop app keeps retrying the WebSocket connection.
- Assistant notifications are shown only when the window is hidden.
