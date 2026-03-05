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

  // POST /api/sessions/:id/clone
  app.post('/api/sessions/:id/clone', (req, res) => {
    const { id } = req.params;
    const { projectPath } = req.body;
    const settings = loadSettings();
    const terminal = settings.terminal || 'default';

    const cdCmd = projectPath ? `cd ${projectPath.replace(/'/g, "'\\''")} && ` : '';
    const claudeCmd = `${cdCmd}unset CLAUDECODE && claude --resume ${id}`;
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
        // Warp uses standard "do script" like Terminal.app
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
            command: `claude --resume ${id}`,
          });
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
      // Try Terminal.app first, fall back to iTerm2
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
