const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const https = require('https');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const STARS_FILE = path.join(CLAUDE_DIR, 'session-manager-stars.json');
const META_FILE = path.join(CLAUDE_DIR, 'session-manager-meta.json');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'session-manager-settings.json');
const CLONE_HISTORY_FILE = path.join(CLAUDE_DIR, 'session-manager-clone-history.json');
const NOTES_FILE = path.join(CLAUDE_DIR, 'session-manager-notes.json');
const NOTES_DIR = path.join(CLAUDE_DIR, 'session-manager-notes');
const MEMORY_PATHS_FILE = path.join(CLAUDE_DIR, 'session-manager-memory-paths.json');

function loadCloneHistory() {
  try { return JSON.parse(fs.readFileSync(CLONE_HISTORY_FILE, 'utf-8')); }
  catch { return []; }
}

function saveCloneHistory(history) {
  fs.writeFileSync(CLONE_HISTORY_FILE, JSON.stringify(history, null, 2));
}

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

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return { terminal: 'default' };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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
      const meta = loadMeta();
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

          const sessionMeta = meta[sessionId] || {};
          sessions.push({
            id: sessionId,
            projectDir: projDir,
            projectPath: decodedPath,
            filePath,
            fileSize: stat.size,
            createdAt: metadata.firstTimestamp || stat.birthtime.toISOString(),
            updatedAt: metadata.lastTimestamp || stat.mtime.toISOString(),
            starred: !!stars[sessionId],
            customName: sessionMeta.name || undefined,
            customDescription: sessionMeta.description || undefined,
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

  // POST /api/sessions/:id/meta
  app.post('/api/sessions/:id/meta', (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const meta = loadMeta();
    meta[id] = { name: name || '', description: description || '' };
    if (!meta[id].name && !meta[id].description) delete meta[id];
    saveMeta(meta);
    res.json({ success: true });
  });

  // GET /api/settings
  app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
  });

  // POST /api/settings
  app.post('/api/settings', (req, res) => {
    const settings = loadSettings();
    Object.assign(settings, req.body);
    saveSettings(settings);
    res.json(settings);
  });

  // GET /api/clone-history
  app.get('/api/clone-history', (req, res) => {
    res.json(loadCloneHistory());
  });

  // GET /api/notes
  app.get('/api/notes', (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
      res.json(data);
    } catch {
      res.json({ content: '' });
    }
  });

  // PUT /api/notes
  app.put('/api/notes', express.json(), (req, res) => {
    const { content, filePath } = req.body;
    const data = { content, updatedAt: new Date().toISOString() };
    if (filePath) data.filePath = filePath;
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  });

  // POST /api/notes/save-md — save current notes as an .md file
  app.post('/api/notes/save-md', express.json(), (req, res) => {
    const { content, filename } = req.body;
    if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(NOTES_DIR, safeName);
    fs.writeFileSync(filePath, content);
    res.json({ success: true, filename: safeName, path: filePath });
  });

  // GET /api/notes/files — list saved .md files
  app.get('/api/notes/files', (req, res) => {
    if (!fs.existsSync(NOTES_DIR)) return res.json({ files: [], dir: NOTES_DIR });
    const files = fs.readdirSync(NOTES_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = fs.statSync(path.join(NOTES_DIR, f));
        const kb = (stat.size / 1024).toFixed(1) + ' KB';
        const date = stat.mtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return { name: f, size: kb, date };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json({ files, dir: NOTES_DIR });
  });

  // GET /api/notes/files/:name — read a saved .md file
  app.get('/api/notes/files/:name', (req, res) => {
    const safeName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(NOTES_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json({ content: fs.readFileSync(filePath, 'utf-8') });
  });

  // DELETE /api/notes/files/:name — delete a saved .md file
  app.delete('/api/notes/files/:name', (req, res) => {
    const safeName = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(NOTES_DIR, safeName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  });

  // GET /api/memory/paths — get saved root paths
  app.get('/api/memory/paths', (req, res) => {
    try {
      const paths = JSON.parse(fs.readFileSync(MEMORY_PATHS_FILE, 'utf-8'));
      res.json({ paths });
    } catch {
      res.json({ paths: [] });
    }
  });

  // POST /api/memory/paths — add a root path
  app.post('/api/memory/paths', express.json(), (req, res) => {
    const { path: newPath } = req.body;
    if (!newPath || !fs.existsSync(newPath)) return res.status(400).json({ error: 'Invalid path' });
    let paths = [];
    try { paths = JSON.parse(fs.readFileSync(MEMORY_PATHS_FILE, 'utf-8')); } catch {}
    if (!paths.includes(newPath)) paths.push(newPath);
    fs.writeFileSync(MEMORY_PATHS_FILE, JSON.stringify(paths, null, 2));
    res.json({ paths });
  });

  // DELETE /api/memory/paths — remove a root path
  app.delete('/api/memory/paths', express.json(), (req, res) => {
    const { path: rmPath } = req.body;
    let paths = [];
    try { paths = JSON.parse(fs.readFileSync(MEMORY_PATHS_FILE, 'utf-8')); } catch {}
    paths = paths.filter(p => p !== rmPath);
    fs.writeFileSync(MEMORY_PATHS_FILE, JSON.stringify(paths, null, 2));
    res.json({ paths });
  });

  // Check if a directory contains .md files (up to 3 levels deep)
  function hasMdFiles(dirPath, depth = 0) {
    if (depth > 3) return false;
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.')) continue;
        if (item.isFile() && item.name.endsWith('.md')) return true;
        if (item.isDirectory() && hasMdFiles(path.join(dirPath, item.name), depth + 1)) return true;
      }
    } catch {}
    return false;
  }

  // GET /api/memory/browse — list dirs (with .md files) and .md files at a path
  app.get('/api/memory/browse', (req, res) => {
    const dir = req.query.path;
    if (!dir || !fs.existsSync(dir)) return res.status(400).json({ error: 'Invalid path' });
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .filter(e => hasMdFiles(path.join(dir, e.name)))
        .map(e => ({ name: e.name, type: 'dir', path: path.join(dir, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = entries
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => {
          const s = fs.statSync(path.join(dir, e.name));
          return { name: e.name, type: 'file', path: path.join(dir, e.name), size: s.size, modified: s.mtime };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ entries: [...dirs, ...files], current: dir, parent: path.dirname(dir) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/memory/file — read an .md file
  app.get('/api/memory/file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.json({ content: fs.readFileSync(filePath, 'utf-8'), path: filePath });
  });

  // PUT /api/memory/file — save an .md file
  app.put('/api/memory/file', express.json(), (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No path' });
    fs.writeFileSync(filePath, content);
    res.json({ success: true });
  });

  // POST /api/clone-history/:index/meta — update a clone entry's name/description
  app.post('/api/clone-history/:index/meta', (req, res) => {
    const idx = parseInt(req.params.index, 10);
    const { name, description } = req.body;
    const history = loadCloneHistory();
    if (idx < 0 || idx >= history.length) return res.status(404).json({ error: 'Not found' });
    if (name !== undefined) history[idx].customName = name || undefined;
    if (description !== undefined) history[idx].customDescription = description || undefined;
    saveCloneHistory(history);
    res.json({ success: true });
  });

    // GET /api/active-sessions — check which sessions have running claude processes
  app.get('/api/active-sessions', (req, res) => {
    exec('ps aux', (err, stdout) => {
      if (err) return res.json({ activeIds: [] });
      const lines = stdout.split('\n');
      const activeIds = [];
      for (const line of lines) {
        const match = line.match(/claude\s+.*--resume\s+([a-f0-9-]{36})/);
        if (match) activeIds.push(match[1]);
      }
      res.json({ activeIds: [...new Set(activeIds)] });
    });
  });

  // POST /api/sessions/:id/clone
  app.post('/api/sessions/:id/clone', (req, res) => {
    const { id } = req.params;
    const { projectPath, sessionName } = req.body;
    const settings = loadSettings();
    const terminal = settings.terminal || 'default';

    const tabTitle = (sessionName || id.slice(0, 8)).replace(/"/g, '\\"').replace(/'/g, '');
    const cdCmd = projectPath ? `cd ${projectPath.replace(/'/g, "'\\''")} && ` : '';
    const claudeCmd = `${cdCmd}unset CLAUDECODE && claude --dangerously-skip-permissions --resume ${id}`;
    const escapedCmd = claudeCmd.replace(/"/g, '\\"');

    function tryTerminal(terminalApp, fallback) {
      let script;
      if (terminalApp === 'iterm2') {
        script = `
          tell application "iTerm2"
            activate
            create window with default profile
            tell current session of current window
              set name to "${tabTitle}"
              write text "${escapedCmd}"
            end tell
          end tell
        `;
      } else if (terminalApp === 'warp') {
        script = `
          tell application "Warp"
            activate
            do script "${escapedCmd}"
          end tell
        `;
      } else {
        script = `
          tell application "Terminal"
            activate
            do script "${escapedCmd}"
          end tell
        `;
      }

      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err && fallback) {
          fallback();
        } else if (err) {
          console.error('Failed to open terminal:', err);
          res.status(500).json({
            error: 'Failed to open terminal',
            command: `claude --dangerously-skip-permissions --resume ${id}`,
          });
        } else {
          const names = { terminal: 'Terminal.app', iterm2: 'iTerm2', warp: 'Warp' };
          // Record clone history
          const history = loadCloneHistory();
          history.unshift({
            sessionId: id,
            sessionName: sessionName || null,
            projectPath: projectPath || null,
            clonedAt: new Date().toISOString(),
            terminal: names[terminalApp] || terminalApp,
          });
          // Keep last 200 entries
          saveCloneHistory(history.slice(0, 200));
          res.json({ success: true, terminal: names[terminalApp] || terminalApp });
        }
      });
    }

    if (terminal === 'iterm2') {
      tryTerminal('iterm2', () => tryTerminal('terminal', null));
    } else if (terminal === 'warp') {
      tryTerminal('warp', () => tryTerminal('terminal', null));
    } else if (terminal === 'default') {
      // Try Terminal.app first, fall back to iTerm2
      tryTerminal('terminal', () => tryTerminal('iterm2', null));
    } else {
      tryTerminal('terminal', null);
    }
  });

  // POST /api/new-session — launch a brand new claude session
  app.post('/api/new-session', (req, res) => {
    const { projectPath } = req.body || {};
    const settings = loadSettings();
    const terminal = settings.terminal || 'default';
    const cdCmd = projectPath ? `cd ${projectPath.replace(/'/g, "'\\''")} && ` : '';
    const claudeCmd = `${cdCmd}unset CLAUDECODE && claude --dangerously-skip-permissions`;
    const escapedCmd = claudeCmd.replace(/"/g, '\\"');

    function tryTerminal(terminalApp, fallback) {
      let script;
      if (terminalApp === 'iterm2') {
        script = `
          tell application "iTerm2"
            activate
            create window with default profile
            tell current session of current window
              write text "${escapedCmd}"
            end tell
          end tell
        `;
      } else if (terminalApp === 'warp') {
        script = `
          tell application "Warp"
            activate
            do script "${escapedCmd}"
          end tell
        `;
      } else {
        script = `
          tell application "Terminal"
            activate
            do script "${escapedCmd}"
          end tell
        `;
      }

      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err && fallback) {
          fallback();
        } else if (err) {
          res.status(500).json({ error: 'Failed to open terminal' });
        } else {
          const names = { terminal: 'Terminal.app', iterm2: 'iTerm2', warp: 'Warp' };
          res.json({ success: true, terminal: names[terminalApp] || terminalApp });
        }
      });
    }

    if (terminal === 'iterm2') {
      tryTerminal('iterm2', () => tryTerminal('terminal', null));
    } else if (terminal === 'warp') {
      tryTerminal('warp', () => tryTerminal('terminal', null));
    } else if (terminal === 'default') {
      tryTerminal('terminal', () => tryTerminal('iterm2', null));
    } else {
      tryTerminal('terminal', null);
    }
  });

  // GET /api/version
  app.get('/api/version', (req, res) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    res.json({ version: pkg.version });
  });

  // GET /api/check-update
  app.get('/api/check-update', (req, res) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    const currentVersion = pkg.version;

    const options = {
      hostname: 'api.github.com',
      path: '/repos/sepehr9000/calculator/releases/latest',
      headers: { 'User-Agent': 'claude-session-manager' },
    };

    https.get(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = (release.tag_name || '').replace(/^v/, '');
          const hasUpdate = latestVersion && latestVersion !== currentVersion;
          const dmgAsset = (release.assets || []).find(a => a.name.endsWith('.dmg'));
          const zipAsset = (release.assets || []).find(a => a.name.endsWith('.zip'));
          res.json({
            currentVersion,
            latestVersion: latestVersion || currentVersion,
            hasUpdate,
            releaseUrl: release.html_url || '',
            downloadUrl: dmgAsset?.browser_download_url || zipAsset?.browser_download_url || release.html_url || '',
            releaseNotes: release.body || '',
          });
        } catch {
          res.json({ currentVersion, latestVersion: currentVersion, hasUpdate: false });
        }
      });
    }).on('error', () => {
      res.json({ currentVersion, latestVersion: currentVersion, hasUpdate: false });
    });
  });

  // GET /api/sessions/:id/compact-summary
  app.get('/api/sessions/:id/compact-summary', (req, res) => {
    try {
      const { id } = req.params;
      const { projectDir } = req.query;
      if (!projectDir) return res.status(400).json({ error: 'projectDir required' });

      const filePath = path.join(PROJECTS_DIR, projectDir, `${id}.jsonl`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Session not found' });

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let lastSummary = null;
      let foundBoundary = false;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.subtype === 'compact_boundary') {
            foundBoundary = true;
            continue;
          }
          if (foundBoundary && entry.type === 'user') {
            const text = typeof entry.message?.content === 'string'
              ? entry.message.content
              : Array.isArray(entry.message?.content)
                ? entry.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
                : '';
            if (text.includes('continued from a previous conversation') || text.includes('summary')) {
              lastSummary = text;
            }
            foundBoundary = false;
          }
        } catch {}
      }

      if (lastSummary) {
        res.json({ summary: lastSummary });
      } else {
        res.json({ summary: null, message: 'No compact summary found for this session' });
      }
    } catch (err) {
      console.error('Error getting compact summary:', err);
      res.status(500).json({ error: 'Failed to get summary' });
    }
  });

  // POST /api/sessions/:id/ai-summary
  app.post('/api/sessions/:id/ai-summary', (req, res) => {
    try {
      const { id } = req.params;
      const { projectDir } = req.body;
      const settings = loadSettings();
      const apiKey = settings.claudeApiKey;

      if (!apiKey) {
        return res.status(400).json({ error: 'Claude API key not configured. Add it in Settings.' });
      }
      if (!projectDir) return res.status(400).json({ error: 'projectDir required' });

      const filePath = path.join(PROJECTS_DIR, projectDir, `${id}.jsonl`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Session not found' });

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Collect conversation text (cap at ~50k chars to stay within limits)
      let conversationText = '';
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'user' || entry.type === 'assistant') {
            const text = typeof entry.message?.content === 'string'
              ? entry.message.content
              : Array.isArray(entry.message?.content)
                ? entry.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
                : '';
            if (text) {
              const role = entry.type === 'user' ? 'User' : 'Assistant';
              conversationText += `${role}: ${text}\n\n`;
              if (conversationText.length > 50000) break;
            }
          }
        } catch {}
      }

      if (!conversationText) {
        return res.json({ summary: 'No messages found in this session.' });
      }

      const requestBody = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Summarize this Claude Code conversation concisely. Include: what was being built/fixed, key decisions made, and the final outcome. Keep it under 300 words.\n\n${conversationText.slice(0, 50000)}`,
        }],
      });

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error) {
              return res.status(400).json({ error: result.error.message || 'API error' });
            }
            const summary = result.content?.[0]?.text || 'No summary generated';
            res.json({ summary });
          } catch {
            res.status(500).json({ error: 'Failed to parse API response' });
          }
        });
      });

      apiReq.on('error', (err) => {
        console.error('API request error:', err);
        res.status(500).json({ error: 'Failed to reach Claude API' });
      });

      apiReq.write(requestBody);
      apiReq.end();
    } catch (err) {
      console.error('Error generating AI summary:', err);
      res.status(500).json({ error: 'Failed to generate summary' });
    }
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
