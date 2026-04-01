# cmd0

A desktop AI agent that lives in your menubar. Summon it with a keystroke.

**Website:** https://dvrosalesm.github.io/cmd0/  
**GitHub:** https://github.com/dvrosalesm/cmd0  
**License:** MIT

---

## What is cmd0?

cmd0 is a desktop companion that reads files, runs commands, browses the web, and modifies its own code. Built with the [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) framework.

Summon it instantly with **⌘0** (macOS) or **Super+0** (Linux).

---

## Features

### Core Capabilities

- **🔍 Web Search** — Search DuckDuckGo instantly and fetch any URL. Research without leaving your flow.
- **🌐 Browser Control** — Automate Chrome via Playwright. Navigate sites, click elements, fill forms, capture screenshots.
- **💻 System Access** — Run bash commands, read/write files, send desktop notifications. Full machine access.
- **🖼️ Screenshots** — Capture any screen region with one click. Attach images to prompts.
- **🔄 Self-Modification** — Use `/0` to edit source code. Evolve, add features, fix bugs autonomously.
- **⏰ Task Daemon** — Schedule recurring or one-time tasks. Background runner checks every minute.
- **💾 Snapshots** — Save/restore complete state with `/snap` and `/restore`. Experiment freely.
- **🔐 Safe Mode** — Start with `--safe` to disable self-modification. Perfect for testing.
- **⚡ Instant Access** — Global hotkey works from anywhere.

### Extension: pi-notetaker

A pi extension for meeting notes: record audio, transcribe locally with Whisper, and generate AI summaries — all offline and private.

**Repository:** https://github.com/dvrosalesm/pi-notetaker

**Commands:**
- `/meeting start [name]` — Start recording
- `/meeting stop` — Stop, transcribe & summarize
- `/meeting list` — List past meetings
- `/meeting view <id>` — View meeting summary
- `/meeting setup` — Install dependencies

**Features:**
- 🎙️ Local audio recording (sox/ffmpeg)
- 🧠 Local transcription (whisper-cpp)
- 📝 AI-generated summaries via active LLM
- 🔒 100% offline, no data leaves your machine

---

## Installation

```bash
# Clone the repository
git clone https://github.com/dvrosalesm/cmd0.git
cd cmd0

# Run the installer
./install.sh
```

The installer will:
1. Install dependencies via npm
2. Build TypeScript and compile the app
3. Register global hotkey shortcut
4. Launch in your menubar

---

## Quick Start

1. **Summon** — Press `Cmd+0` (macOS) or `Super+0` (Linux)
2. **Ask** — Type commands or natural language requests
3. **Extend** — Use `/0` to modify the agent

---

## Commands

| Command | Description |
|---------|-------------|
| `/0` | Modify own source code (read, write, reload) |
| `/cancel` | Stop current operation |
| `/tasks` | Manage background tasks |
| `/snap <name>` | Save state snapshot |
| `/restore <name>` | Restore from snapshot |
| `/safe` | Restart in safe mode |

---

## Configuration

On first launch, cmd0 asks for your API key.

### Supported Providers

**OpenRouter** (keys starting with `sk-or-...`)
- Default model: `minimax/minimax-m2.7`
- Supports hundreds of models (Claude, GPT-4, Llama)

**Fireworks AI** (keys starting with `fw_...`)
- Default model: `accounts/fireworks/routers/kimi-k2p5-turbo`
- Fast inference with Kimi, Llama, and more

Config stored at: `~/.cmd0/data/config.json`

---

## Project Structure

```
~/.cmd0/
├── anima/              # Live source code (self-modifiable)
├── data/
│   ├── config.json    # API keys, settings
│   └── meetings/      # pi-notetaker recordings
├── snapshots/         # Saved states
└── tasks.md          # Background tasks
```

---

## Platform Support

- **macOS** — Full support, Cmd+0 hotkey
- **Linux** — Full support, Super+0 hotkey (works on X11 and Wayland/Hyprland)
- **Windows** — Not currently supported

---

## Architecture

Built on [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) framework:

- **Electron** — Desktop shell, transparent frameless window
- **TypeScript** — Main process, renderer, features
- **Feature system** — Modular tools (web, browser, system, tasks, anima)
- **Self-modification** — Source in `~/.cmd0/anima/`, synced to project

---

## Contributing

Contributions welcome via GitHub:
https://github.com/dvrosalesm/cmd0

---

## Analytics

This site uses Google Analytics 4 to understand visitor engagement.

---

© 2026 cmd0. Built with pi-coding-agent.
