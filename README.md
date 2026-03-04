# Claude Session Manager

A desktop app (Electron) to browse, star, and clone your Claude Code sessions.

## Features

- **Browse** all your Claude Code sessions across every project
- **Search** by content, project name, or session ID
- **Star** your favorite sessions so you never lose them
- **Preview** full conversation history in a side panel
- **Clone** any session — opens a new Terminal window with `claude --resume <id>`, ready to go
- **Filter** by project or starred status

## Quick Start

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Build the frontend
npm run build:client

# Launch the desktop app
npm start
```

## Development

```bash
# Run everything (server + vite + electron)
npm run electron:dev

# Or run the web version only (no Electron)
npm run dev
# Then open http://localhost:3001
```

## Build macOS App

```bash
npm run electron:build
```

This creates a `Claude Session Manager.app` in the `dist/` folder that you can drag to your Applications folder.

## How It Works

1. Reads session JSONL files from `~/.claude/projects/`
2. Parses metadata (first message, timestamps, message count, model)
3. Stars are stored in `~/.claude/session-manager-stars.json`
4. Clone uses `osascript` to open Terminal.app (or iTerm2) with `claude --resume <session-id>`

## Requirements

- Node.js 18+
- macOS (for terminal launching and .app packaging)
- Claude Code installed (`claude` CLI available in PATH)
