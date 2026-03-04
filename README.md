# Claude Session Manager

Never lose a great Claude Code session again.

A desktop app that gives you a visual UI for all your Claude Code sessions. Browse them, star the ones you love, and clone any session into a fresh terminal with one click.

![Claude Session Manager](https://img.shields.io/badge/platform-macOS-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## The Problem

You have an amazing Claude Code session — deep context on your project, great conversation history — and then you lose track of it. Claude Code stores sessions locally forever, but there's no good way to browse, organize, or get back into them.

## The Solution

Claude Session Manager reads your local `~/.claude/projects/` session files and gives you:

- **Browse** every session across all your projects, sorted by most recent
- **Search** by conversation content, project name, or session ID
- **Star** sessions you want to keep track of
- **Preview** the full conversation in a side panel
- **Clone** — one click opens a new Terminal window with `claude --resume <id>`, right in the project directory
- **Filter** by project or starred status

---

## Install & Run

### Prerequisites

- **Node.js 18+** — [download here](https://nodejs.org)
- **Claude Code** — the `claude` CLI must be installed and in your PATH
- **macOS** — required for the Clone-to-Terminal feature (app browsing works on any OS)

### Option 1: Run the Desktop App (Recommended)

```bash
# Clone the repo
git clone https://github.com/sepehr9000/calculator.git claude-session-manager
cd claude-session-manager

# Install everything
npm install
cd client && npm install && cd ..

# Build the frontend
npm run build:client

# Launch the app
npm start
```

A native desktop window opens — no browser needed.

### Option 2: Build a Standalone .app

```bash
# After installing dependencies (see above)
npm run electron:build
```

This creates **Claude Session Manager.app** in the `dist/` folder. Drag it to your Applications folder and you're done — double-click to launch anytime.

### Option 3: Run as a Web App (no Electron)

```bash
npm run dev
```

Opens at `http://localhost:3001`. Useful if you're on Linux/Windows or just prefer a browser.

---

## How It Works

```
~/.claude/projects/
├── home-user-my-project/
│   ├── abc123.jsonl          ← Claude Code session transcript
│   ├── abc123-summary.jsonl
│   ├── def456.jsonl
│   └── ...
└── home-user-another-project/
    └── ...
```

1. **Scans** `~/.claude/projects/` for all `.jsonl` session files
2. **Parses** each file to extract: first user message, timestamps, message count, model used
3. **Displays** sessions in a searchable, filterable list
4. **Stars** are saved to `~/.claude/session-manager-stars.json`
5. **Clone** uses `osascript` to open Terminal.app (falls back to iTerm2) running `claude --resume <session-id>` in the correct project directory

---

## Project Structure

```
claude-session-manager/
├── electron/
│   └── main.js           # Electron main process — creates window, boots server
├── server/
│   └── index.js           # Express API — reads sessions, handles starring & cloning
├── client/
│   ├── src/
│   │   ├── App.jsx        # React UI — session list, search, filters, detail panel
│   │   ├── main.jsx       # React entry point
│   │   └── styles.css     # Dark theme styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── assets/                # App icons (contribute one!)
├── package.json           # Root config with Electron + electron-builder
└── README.md
```

---

## Contributing

This is an open source project and contributions are welcome! Here's how to get set up for development:

```bash
git clone https://github.com/sepehr9000/calculator.git claude-session-manager
cd claude-session-manager
npm install
cd client && npm install && cd ..

# Start in dev mode (hot reload for frontend + backend + Electron)
npm run electron:dev
```

### Ideas for Contributions

- **Session tagging/notes** — add custom tags or notes to sessions beyond just starring
- **Export sessions** — export a session as Markdown, PDF, or shareable link
- **Session diff** — compare two sessions side by side
- **Linux/Windows terminal support** — add `gnome-terminal`, `wt.exe`, etc. for the Clone feature
- **Session grouping** — group related sessions together (e.g., all sessions for a feature branch)
- **App icon** — we need a proper macOS app icon in `assets/`
- **Auto-refresh** — watch `~/.claude/projects/` for new sessions and update the list live
- **Keyboard shortcuts** — navigate and clone sessions without touching the mouse

### Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Web-only mode (Express + Vite, no Electron) |
| `npm run electron:dev` | Full dev mode (Express + Vite + Electron with hot reload) |
| `npm run build:client` | Build the React frontend |
| `npm run electron:build` | Package as macOS .app / .dmg |
| `npm start` | Launch Electron app (requires built frontend) |

### Pull Request Guidelines

1. Fork the repo and create your branch from `main`
2. If you've added functionality, update this README
3. Make sure the app builds: `npm run build:client`
4. Keep PRs focused — one feature or fix per PR

---

## Tech Stack

- **Electron** — native desktop window
- **React 18** — UI components
- **Vite** — frontend build tool
- **Express** — API server (embedded in Electron)
- **Node.js** — session file parsing and terminal launching

---

## FAQ

**Q: Where does Claude Code store sessions?**
A: Locally at `~/.claude/projects/{encoded-project-path}/{session-uuid}.jsonl`. They persist indefinitely until you manually delete them.

**Q: Does this upload my sessions anywhere?**
A: No. Everything runs locally. The app only reads files from your disk and opens local terminals.

**Q: Can I use this on Linux or Windows?**
A: The browsing/starring/searching works anywhere. The "Clone to Terminal" button currently only supports macOS (Terminal.app and iTerm2). Linux/Windows terminal support is a great contribution opportunity!

**Q: What's the Clone button do exactly?**
A: It opens a new Terminal.app window, `cd`s into the project directory, and runs `claude --resume <session-id>`. You get a fresh Claude Code session with the full conversation history loaded.

---

## License

MIT
