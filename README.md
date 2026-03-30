# cmd0

A desktop AI agent that lives in your system tray. Press **Cmd+0** (macOS) or **Super+-** (Linux) anywhere to summon it.

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-13+-white.svg)](https://apple.com/macos)
[![Linux](https://img.shields.io/badge/Linux-Wayland%20%7C%20X11-white.svg)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-41+-white.svg)](https://electronjs.org)
[![GitHub stars](https://img.shields.io/github/stars/dvrosalesm/cmd0?style=social)](https://github.com/dvrosalesm/cmd0)

---

## What is cmd0?

cmd0 is a lightweight, always-on desktop companion powered by LLMs (OpenRouter or Fireworks AI). It features:

- **Global hotkey** — Press `Cmd+0` (macOS) or `Super+-` (Linux/Hyprland) to toggle a floating chat window
- **Web search & fetch** — DuckDuckGo search and URL content extraction
- **Browser automation** — Control Chrome via Playwright (navigate, click, fill, screenshot)
- **System access** — Run bash commands, read/write files, send desktop notifications
- **Screenshots** — Capture any screen region (macOS `screencapture` / Linux `grim` + `slurp`)
- **Self-modification** — The agent can edit its own source code via the `/0` command
- **Task daemon** — Schedule recurring or one-time background tasks
- **Snapshots** — Save and restore complete application state

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/dvrosalesm/cmd0.git
cd cmd0

# Install
curl -fsSL https://raw.githubusercontent.com/dvrosalesm/cmd0/main/install.sh | bash

# Or run install script directly
./install.sh
```

On first launch, cmd0 will prompt for your API key.

---

## Usage

| Command | Description |
|---------|-------------|
| `Cmd+0` / `Super+-` | Toggle the chat window |
| `/0 <instruction>` | Modify own source code |
| `/cancel` | Stop current operation |
| `/tasks` | List, add, or remove tasks |
| `/snap <name>` | Save a snapshot |
| `/restore <name>` | Restore a snapshot |
| `/snapshots` | List all snapshots |
| `/safe` | Restart in safe mode |

---

## Architecture

```
cmd0/
├── src/
│   ├── main.ts      # Electron main process
│   ├── renderer.ts   # Chat UI logic
│   └── style.css    # Dark translucent theme
├── index.html        # Floating window UI
├── preload.cjs       # IPC bridge
├── me.md            # Agent personality & rules
└── ~/.cmd0/
    ├── anima/        # Editable source files
    ├── data/         # Config & sessions
    └── snapshots/    # Saved states
```

---

## Self-Modification

cmd0 can edit its own source code. The `/0` command triggers a sequence:

1. `anima_list` — List editable files in `~/.cmd0/anima/`
2. `anima_read` — Read relevant files
3. `anima_write` — Apply changes
4. `anima_reload` — Recompile and restart

Use responsibly — broken code won't restart.

---

## Safe Mode

Launch with `--safe` to disable:
- Self-modification (`/0`)
- File system access outside project directory
- Anima context loading

```bash
cmd0 --safe
```

---

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in dev mode
npm run dev
```

---

## Requirements

- macOS 13+ or Linux (Wayland/X11)
- Node.js 18+
- OpenRouter or Fireworks AI API key
- **Linux extras:** `grim`, `slurp`, `libnotify`, `wl-clipboard` (Wayland)

---

## License

MIT — See [LICENSE](LICENSE)

---

Built with [pi-coding-agent](https://github.com/mario-zechner/pi-coding-agent)
