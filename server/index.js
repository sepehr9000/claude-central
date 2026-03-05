const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const STARS_FILE = path.join(CLAUDE_DIR, 'session-manager-stars.json');

function loadStars() {
  try {
    return JSON.parse(fs.readFileSync(STARS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStars(stars) {
  fs.writeFileSync(STARS_FILE, JSON.stringify(stars, null, 2));
}

function decodeProjectPath(dirName) {
  return '/' + dirName.replace(/-/g, '/');
}

function parseSessionMetadata(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    let firstUserMessage = null;
    let lastTimestamp = null;
    let firstTimestamp = null;
    let messageCount = 0;
    let model = null;
    let workingDirectory = null;
    let gitBranch = null;
    let sessionName = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.timestamp) {
          if (!firstTimestamp) firstTimestamp = entry.timestamp;
          lastTimestamp = entry.timestamp;
        }

        if (!firstUserMessage && entry.type === 'user' && entry.message?.content) {
          const content = typeof entry.message.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message.content)
              ? entry.message.content.find(b => b.type === 'text')?.text || ''
              : '';
          firstUserMessage = content.slice(0, 200);
        }

        if (entry.type === 'user' || entry.type === 'assistant') {
          messageCount++;
        }

        if (entry.model && !model) {
          model = entry.model;
        }

        if (entry.cwd && !workingDirectory) {
          workingDirectory = entry.cwd;
        }

        if (entry.type === 'session_name' || entry.sessionName) {
          sessionName = entry.sessionName || entry.name;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      firstUserMessage,
      firstTimestamp,
      lastTimestamp,
      messageCount,
      model,
      workingDirectory,
      gitBranch,
      sessionName,
      lineCount: lines.length,
    };
  } catch {
    return null;
  }
}

function createServer(staticDir) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static frontend files
  if (staticDir) {
    app.use(express.static(staticDir));
  }

  // GET /api/sessions
  app.get('/api/sessions', (req, res) => {
    try {
      if (!fs.existsSync(PROJECTS_DIR)) {
        return res.json({ sessions: [] });
      }

      const stars = loadStars();
      const sessions = [];
      const projectDirs = fs.readdirSync(PROJECTS_DIR);

      for (const projDir of projectDirs) {
        const projPath = path.join(PROJECTS_DIR, projDir);
        if (!fs.statSync(projPath).isDirectory()) continue;

        const decodedPath = decodeProjectPath(projDir);
        const files = fs.readdirSync(projPath);

        for (const file of files) {
          if (!file.endsWith('.jsonl') || file.includes('-summary')) continue;

          const sessionId = file.replace('.jsonl', '');
          const filePath = path.join(projPath, file);
          const stat = fs.statSync(filePath);
          const metadata = parseSessionMetadata(filePath);

          if (!metadata || metadata.messageCount === 0) continue;

          sessions.push({
            id: sessionId,
            projectDir: projDir,
            projectPath: decodedPath,
            filePath,
            fileSize: stat.size,
            createdAt: metadata.firstTimestamp || stat.birthtime.toISOString(),
            updatedAt: metadata.lastTimestamp || stat.mtime.toISOString(),
            starred: !!stars[sessionId],
            ...metadata,
          });
        }
      }

      sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      res.json({ sessions });
    } catch (err) {
      console.error('Error listing sessions:', err);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // GET /api/sessions/:id/messages
  app.get('/api/sessions/:id/messages', (req, res) => {
    try {
      const { id } = req.params;
      const { projectDir } = req.query;

      if (!projectDir) {
        return res.status(400).json({ error: 'projectDir query param required' });
      }

      const filePath = path.join(PROJECTS_DIR, projectDir, `${id}.jsonl`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const messages = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' || entry.type === 'assistant') {
            const text = typeof entry.message?.content === 'string'
              ? entry.message.content
              : Array.isArray(entry.message?.content)
                ? entry.message.content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join('\n')
                : '';
            messages.push({
              role: entry.type,
              content: text,
              timestamp: entry.timestamp,
            });
          }
        } catch {
          // Skip malformed
        }
      }

      res.json({ messages });
    } catch (err) {
      console.error('Error reading session:', err);
      res.status(500).json({ error: 'Failed to read session' });
    }
  });

  // POST /api/sessions/:id/star
  app.post('/api/sessions/:id/star', (req, res) => {
    const { id } = req.params;
    const stars = loadStars();
    stars[id] = !stars[id];
    if (!stars[id]) delete stars[id];
    saveStars(stars);
    res.json({ starred: !!stars[id] });
  });

  // POST /api/sessions/:id/clone
  app.post('/api/sessions/:id/clone', (req, res) => {
    const { id } = req.params;
    const { projectPath } = req.body;

    const cdCmd = projectPath ? `cd ${projectPath.replace(/'/g, "'\\''")} && ` : '';
    const claudeCmd = `${cdCmd}claude --resume ${id}`;

    const script = `
      tell application "Terminal"
        activate
        do script "${claudeCmd.replace(/"/g, '\\"')}"
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) {
        const itermScript = `
          tell application "iTerm2"
            activate
            create window with default profile command "${claudeCmd.replace(/"/g, '\\"')}"
          end tell
        `;
        exec(`osascript -e '${itermScript.replace(/'/g, "'\\''")}'`, (err2) => {
          if (err2) {
            console.error('Failed to open terminal:', err2);
            return res.status(500).json({
              error: 'Failed to open terminal',
              command: `claude --resume ${id}`,
            });
          }
          res.json({ success: true, terminal: 'iTerm2' });
        });
        return;
      }
      res.json({ success: true, terminal: 'Terminal.app' });
    });
  });

  // SPA catch-all
  if (staticDir) {
    app.get('*', (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}

// If run directly (dev mode), start the server
if (require.main === module) {
  const staticDir = fs.existsSync(path.join(__dirname, '..', 'client', 'dist'))
    ? path.join(__dirname, '..', 'client', 'dist')
    : null;
  const app = createServer(staticDir);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Claude Session Manager API running on http://localhost:${PORT}`);
    console.log(`Reading sessions from: ${PROJECTS_DIR}`);
  });
}

module.exports = { createServer };
