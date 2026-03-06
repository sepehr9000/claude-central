# Claude Session Manager

Never lose a great Claude Code session again.

A desktop app that gives you a visual UI for all your Claude Code sessions. Browse them, star the ones you love, and clone any session into a fresh terminal with one click.

![Claude Session Manager](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

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
- **macOS, Windows, or Linux** — all features including Clone-to-Terminal work on all platforms

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

### Option 2: Build a Standalone App

```bash
# After installing dependencies (see above)
npm run electron:build
```

This creates a platform-specific installer in the `dist/` folder:
- **macOS** → `.dmg` / `.zip` — drag to Applications
- **Windows** → `.exe` installer (NSIS) — run to install
- **Linux** → `.AppImage` / `.deb` — run directly or install via package manager

> **Note for contributors building Windows/Linux:** You'll need icon files in `assets/`:
> - `icon.ico` (256x256, for Windows) — convert from the existing `.icns`
> - `icon.png` (256x256+, for Linux)
>
> You can generate these from the macOS `.icns` using any image converter or [iConvert Icons](https://iconverticons.com/online/).

### Option 3: Run as a Web App (no Electron)

```bash
npm run dev
```

Opens at `http://localhost:3001`. Useful if you prefer a browser.

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
5. **Clone** opens a terminal window running `claude --resume <session-id>` in the correct project directory
   - **macOS**: Terminal.app, iTerm2, or Warp
   - **Windows**: Windows Terminal, PowerShell, or Command Prompt
   - **Linux**: GNOME Terminal, Konsole, Xfce Terminal, or xterm

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
- **Session grouping** — group related sessions together (e.g., all sessions for a feature branch)
- **App icons** — contribute proper Windows (`.ico`) and Linux (`.png`) icons for `assets/`
- **Auto-refresh** — watch `~/.claude/projects/` for new sessions and update the list live
- **Keyboard shortcuts** — navigate and clone sessions without touching the mouse

### Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Web-only mode (Express + Vite, no Electron) |
| `npm run electron:dev` | Full dev mode (Express + Vite + Electron with hot reload) |
| `npm run build:client` | Build the React frontend |
| `npm run electron:build` | Package as macOS .app/.dmg, Windows .exe, or Linux .AppImage/.deb |
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
A: Yes! All features work on macOS, Windows, and Linux — including Clone-to-Terminal. The app auto-detects your OS and shows the appropriate terminal options in Settings (e.g., Windows Terminal, GNOME Terminal, etc.).

**Q: What's the Clone button do exactly?**
A: It opens a new terminal window, `cd`s into the project directory, and runs `claude --resume <session-id>`. You get a fresh Claude Code session with the full conversation history loaded.

---

## License

MIT
