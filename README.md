# Claude Session Manager

A web UI to browse, star, and clone your Claude Code sessions.

## Features

- **Browse** all your Claude Code sessions across every project
- **Search** by content, project name, or session ID
- **Star** your favorite sessions so you never lose them
- **Preview** full conversation history in a side panel
- **Clone** any session — opens a new Terminal window with `claude --resume <id>`, ready to go
- **Filter** by project or starred status

## Setup

```bash
npm install
cd client && npm install && cd ..
```

## Run (development)

```bash
npm run dev
```

This starts:
- **API server** on `http://localhost:3000`
- **React dev server** on `http://localhost:3001` (proxies API calls to :3000)

Open `http://localhost:3001` in your browser.

## Run (production)

```bash
npm run build
npm start
```

Then open `http://localhost:3000`.

## How It Works

1. Reads session JSONL files from `~/.claude/projects/`
2. Parses metadata (first message, timestamps, message count, model)
3. Stars are stored in `~/.claude/session-manager-stars.json`
4. Clone uses `osascript` to open Terminal.app (or iTerm2) with `claude --resume <session-id>`

## Requirements

- Node.js 18+
- macOS (for terminal launching; the browse/star features work anywhere)
- Claude Code installed (`claude` CLI available in PATH)
