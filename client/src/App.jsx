import React, { useState, useEffect, useMemo } from 'react';

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function projectName(fullPath) {
  if (!fullPath) return 'unknown';
  const parts = fullPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || fullPath;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function getTerminalOptions(platform) {
  if (platform === 'win32') {
    return [
      { value: 'default', label: 'Default (Windows Terminal)' },
      { value: 'powershell', label: 'PowerShell' },
      { value: 'cmd', label: 'Command Prompt' },
    ];
  } else if (platform === 'linux') {
    return [
      { value: 'default', label: 'Default (auto-detect)' },
      { value: 'gnome-terminal', label: 'GNOME Terminal' },
      { value: 'konsole', label: 'Konsole' },
      { value: 'xfce4-terminal', label: 'Xfce Terminal' },
      { value: 'xterm', label: 'xterm' },
    ];
  }
  // macOS
  return [
    { value: 'default', label: 'Default (Terminal.app)' },
    { value: 'iterm2', label: 'iTerm2' },
    { value: 'warp', label: 'Warp' },
  ];
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('starred');
  const [toast, setToast] = useState(null);
  const [editingSession, setEditingSession] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [settings, setSettings] = useState({ terminal: 'default', launchOnStartup: false, theme: 'dark' });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [summaryModal, setSummaryModal] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [platform, setPlatform] = useState('darwin');
  const [activeSessionIds, setActiveSessionIds] = useState([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [memoryPaths, setMemoryPaths] = useState([]);
  const [memoryBrowsePath, setMemoryBrowsePath] = useState(null);
  const [memoryEntries, setMemoryEntries] = useState([]);
  const [memoryBreadcrumb, setMemoryBreadcrumb] = useState([]);
  const [memoryFiles, setMemoryFiles] = useState({});
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [fileContents, setFileContents] = useState({});
  const [cloneHistory, setCloneHistory] = useState([]);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState(new Set());
  const [editingClone, setEditingClone] = useState(null);
  const [editCloneName, setEditCloneName] = useState('');

  useEffect(() => {
    fetchSessions();
    fetchSettings();
    fetchActiveSessions();
    fetchCloneHistory();
    fetch('/api/platform').then(r => r.json()).then(d => setPlatform(d.platform)).catch(() => {});
    const interval = setInterval(fetchActiveSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchActiveSessions() {
    try {
      const res = await fetch('/api/active-sessions');
      const data = await res.json();
      setActiveSessionIds(data.activeIds || []);
    } catch {}
  }

  async function fetchCloneHistory() {
    try {
      const res = await fetch('/api/clone-history');
      const data = await res.json();
      setCloneHistory(data);
    } catch {}
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
  }, [settings.theme]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch {}
  }

  async function checkForUpdates() {
    setCheckingUpdate(true);
    try {
      const res = await fetch('/api/check-update');
      const data = await res.json();
      setUpdateInfo(data);
      if (!data.hasUpdate) {
        showToast('Already up to date', 'success');
      }
    } catch {
      showToast('Failed to check for updates', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function applyUpdate() {
    setCheckingUpdate(true);
    showToast('Pulling & rebuilding...', 'success');
    try {
      const res = await fetch('/api/apply-update', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Updated! Reloading...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast('Update failed: ' + (data.error || 'unknown'), 'error');
      }
    } catch {
      // Server restarted — just reload
      setTimeout(() => window.location.reload(), 2000);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function updateSettings(newSettings) {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      showToast('Settings saved', 'success');
    } catch {
      showToast('Failed to save settings', 'error');
    }
  }

  async function fetchSessions() {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      showToast('Failed to load sessions', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function toggleStar(e, session) {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${session.id}/star`, { method: 'POST' });
      const data = await res.json();
      setSessions(prev =>
        prev.map(s => s.id === session.id ? { ...s, starred: data.starred } : s)
      );
    } catch {
      showToast('Failed to toggle star', 'error');
    }
  }

  async function cloneSession(e, session) {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${session.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: session.projectPath,
          sessionName: session.customName || session.sessionName || truncate(session.firstUserMessage, 40) || session.id.slice(0, 8),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Opened in ${data.terminal}`, 'success');
        setTimeout(fetchActiveSessions, 2000);
        fetchCloneHistory();
      } else {
        showToast(`Command: claude --resume ${session.id}`, 'error');
      }
    } catch {
      showToast('Failed to open terminal', 'error');
    }
  }


  async function getCompactSummary(e, session) {
    e.stopPropagation();
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/compact-summary?projectDir=${encodeURIComponent(session.projectDir)}`);
      const data = await res.json();
      if (data.summary) {
        setSummaryModal({ title: 'Session Summary', text: data.summary, session });
      } else {
        showToast('No compact summary found for this session', 'error');
      }
    } catch {
      showToast('Failed to get summary', 'error');
    } finally {
      setSummaryLoading(false);
    }
  }

  async function getAiSummary(e, session) {
    e.stopPropagation();
    if (!settings.claudeApiKey) {
      showToast('Add your Claude API key in Settings first', 'error');
      return;
    }
    setSummaryLoading(true);
    setSummaryModal({ title: 'AI Summary', text: 'Generating summary...', session, loading: true });
    try {
      const res = await fetch(`/api/sessions/${session.id}/ai-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: session.projectDir }),
      });
      const data = await res.json();
      if (data.summary) {
        setSummaryModal({ title: 'AI Summary', text: data.summary, session });
      } else {
        setSummaryModal(null);
        showToast(data.error || 'Failed to generate summary', 'error');
      }
    } catch {
      setSummaryModal(null);
      showToast('Failed to generate AI summary', 'error');
    } finally {
      setSummaryLoading(false);
    }
  }

  function copySummary() {
    if (summaryModal?.text) {
      navigator.clipboard.writeText(summaryModal.text);
      showToast('Summary copied to clipboard', 'success');
    }
  }

  function openEditModal(e, session) {
    e.stopPropagation();
    setEditingSession(session);
    setEditName(session.customName || '');
    setEditDescription(session.customDescription || '');
  }

  async function saveSessionMeta() {
    if (!editingSession) return;
    try {
      const res = await fetch(`/api/sessions/${editingSession.id}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDescription }),
      });
      const data = await res.json();
      if (data.success) {
        setSessions(prev =>
          prev.map(s =>
            s.id === editingSession.id
              ? { ...s, customName: editName || undefined, customDescription: editDescription || undefined }
              : s
          )
        );
        showToast('Session updated', 'success');
      }
    } catch {
      showToast('Failed to save', 'error');
    }
    setEditingSession(null);
  }

  async function saveCloneEdit() {
    if (!editingClone) return;
    try {
      const res = await fetch(`/api/clone-history/${editingClone.index}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editCloneName }),
      });
      const data = await res.json();
      if (data.success) {
        fetchCloneHistory();
        showToast('Clone entry updated', 'success');
      }
    } catch {
      showToast('Failed to save', 'error');
    }
    setEditingClone(null);
  }

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const projects = useMemo(() => {
    const set = new Set(sessions.map(s => projectName(s.projectPath)));
    return [...set].sort();
  }, [sessions]);

  async function fetchMemoryPaths() {
    try {
      const res = await fetch('/api/memory/paths');
      const data = await res.json();
      setMemoryPaths(data.paths || []);
      for (const p of (data.paths || [])) {
        fetchMemoryFiles(p);
      }
    } catch {}
  }

  async function fetchMemoryFiles(rootPath) {
    try {
      const res = await fetch('/api/memory/tree?path=' + encodeURIComponent(rootPath));
      const data = await res.json();
      if (data.files) {
        setMemoryFiles(prev => ({ ...prev, [rootPath]: { files: data.files, rootName: data.rootName } }));
      }
    } catch {}
  }

  async function addMemoryPath(p) {
    if (!p || !p.trim()) return;
    try {
      const res = await fetch('/api/memory/paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p.trim() }),
      });
      const data = await res.json();
      if (data.error) { showToast(data.error, 'error'); return; }
      setMemoryPaths(data.paths || []);
      fetchMemoryFiles(p.trim());
      showToast('Path added', 'success');
    } catch { showToast('Failed to add path', 'error'); }
  }

  async function browseAndAddPath() {
    if (!window.electronAPI) {
      showToast('Folder picker not available', 'error');
      return;
    }
    const result = await window.electronAPI.pickFolder();
    if (!result.canceled && result.path) {
      addMemoryPath(result.path);
    }
  }

  async function removeMemoryPath(p) {
    try {
      const res = await fetch('/api/memory/paths', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p }),
      });
      const data = await res.json();
      setMemoryPaths(data.paths || []);
      setMemoryFiles(prev => {
        const next = { ...prev };
        delete next[p];
        return next;
      });
    } catch {}
  }

  async function toggleFileExpand(filePath) {
    const isExpanded = expandedFiles.has(filePath);
    if (isExpanded) {
      setExpandedFiles(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    } else {
      if (!fileContents[filePath]) {
        try {
          const res = await fetch('/api/memory/file?path=' + encodeURIComponent(filePath));
          const data = await res.json();
          setFileContents(prev => ({ ...prev, [filePath]: data.content || '' }));
        } catch {}
      }
      setExpandedFiles(prev => new Set([...prev, filePath]));
    }
  }

  function handleContentLinkClick(targetPath) {
    if (!expandedFiles.has(targetPath)) {
      toggleFileExpand(targetPath);
    }
    setTimeout(() => {
      const el = document.querySelector(`[data-filepath="${CSS.escape(targetPath)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  function renderMarkdownContent(content, filePath) {
    const parts = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
    let lastIndex = 0;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      const label = match[1];
      const relativePath = match[2];
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolved = dir + '/' + relativePath;
      parts.push(
        `<a class="memory-link" data-target="${resolved}" href="#">${label}</a>`
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }
    return parts.join('');
  }

  function openMemoryFile(filePath) {
    window.open('/md-editor.html?path=' + encodeURIComponent(filePath), '_blank');
  }

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (filter === 'starred' && !s.starred) return false;
      if (filter !== 'all' && filter !== 'starred' && projectName(s.projectPath) !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = [
          s.firstUserMessage,
          s.sessionName,
          s.customName,
          s.customDescription,
          s.projectPath,
          s.id,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, filter, search]);

  if (loading) {
    return (
      <div className="app">
        <div className="drag-region" />
        <div className="loading">
          <div className="spinner" />
          <p style={{ marginTop: 12 }}>Loading sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="drag-region" />

      {/* Header */}
      <div className="header">
        <h1>
          <img src="/ai-squads-logo.png" alt="AI Squads" className="logo" />
          Session Manager
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="session-count">
            {filtered.length} of {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </span>
          <button
            className="settings-btn"
            onClick={() => { setLoading(true); fetchSessions(); }}
            title="Refresh sessions"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
          <button
            className="settings-btn"
            onClick={() => {
              window.open('/notes.html', 'notes', 'width=500,height=600,resizable=yes,scrollbars=yes');
            }}
            title="Notes"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </button>
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button
            className="settings-btn info-btn"
            onClick={() => setShowInfo(true)}
            title="How to install Claude Code"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <input
          className="search-input"
          type="text"
          placeholder="Search sessions by content, project, or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`filter-btn ${filter === 'starred' ? 'active' : ''}`}
          onClick={() => setFilter('starred')}
        >
          Starred
        </button>
        <button
          className={`filter-btn ${filter === 'history' ? 'active' : ''}`}
          onClick={() => setFilter('history')}
        >
          History
        </button>
        <button
          className={`filter-btn ${filter === 'memory' ? 'active' : ''}`}
          onClick={() => { setFilter('memory'); fetchMemoryPaths(); }}
        >
          Memory
        </button>
      </div>

      {/* Clone History */}
      {filter === 'history' && (
        <div className="session-list">
          {cloneHistory.length === 0 ? (
            <div className="empty-state">
              <h3>No clone history yet</h3>
              <p>Sessions you clone will appear here</p>
            </div>
          ) : (() => {
            const grouped = {};
            const order = [];
            cloneHistory.forEach(entry => {
              if (!grouped[entry.sessionId]) {
                grouped[entry.sessionId] = [];
                order.push(entry.sessionId);
              }
              grouped[entry.sessionId].push(entry);
            });
            return order.map(sessionId => {
              const clones = grouped[sessionId];
              const latest = clones[0];
              const oldest = clones[clones.length - 1];
              const session = sessions.find(s => s.id === sessionId);
              const frozenName = oldest.sessionName || sessionId.slice(0, 8);
              const liveName = (session && (session.customName || session.sessionName || truncate(session.firstUserMessage, 60))) || frozenName;
              const isActive = activeSessionIds.includes(sessionId);
              const isExpanded = expandedHistoryIds.has(sessionId);
              return (
                <div key={sessionId} className="history-group">
                  <div className={`session-card history-parent ${isActive ? 'active' : ''}`}>
                    <button
                      className="history-toggle"
                      onClick={() => setExpandedHistoryIds(prev => {
                        const next = new Set(prev);
                        next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId);
                        return next;
                      })}
                    >
                      <span className={`toggle-arrow ${isExpanded ? 'expanded' : ''}`}>&#9654;</span>
                    </button>
                    <div className="session-info" style={{ cursor: 'default' }}>
                      <div className="session-header">
                        <span className="session-name">{frozenName}</span>
                        {isActive && <span className="active-badge" title="Running in terminal"><span className="active-dot" />LIVE</span>}
                        <span className="history-count">{clones.length} clone{clones.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="session-meta">
                        {latest.projectPath && (
                          <span className="project-badge" title={latest.projectPath}>
                            {projectName(latest.projectPath)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="session-actions">
                      {session && (
                        <button className="action-btn clone-btn" onClick={e => cloneSession(e, session)}>Clone</button>
                      )}
                    </div>
                  </div>
                  {isExpanded && session && (
                    <div className="history-children">
                      {clones.map((entry, i) => {
                        const globalIndex = cloneHistory.indexOf(entry);
                        const cloneName = entry.customName || liveName;
                        return (
                          <div
                            key={i}
                            className={`session-card history-child-card ${isActive ? 'active' : ''}`}
                            onDoubleClick={() => cloneSession(null, session)}
                          >
                            <div className="history-child-timestamp">
                              {new Date(entry.clonedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </div>
                            <div className="session-info">
                              <div className="session-header">
                                {isActive && <span className="active-dot" title="Running in terminal" />}
                                <span className="session-name">{cloneName}</span>
                              </div>
                              <div className="session-meta">
                                <span className="project-badge" title={session.projectPath}>
                                  {projectName(session.projectPath)}
                                </span>
                                <span>{session.messageCount} messages</span>
                              </div>
                            </div>
                            <div className="session-actions">
                              <button
                                className="summary-btn"
                                onClick={e => getCompactSummary(e, session)}
                                disabled={summaryLoading}
                              >
                                Summary
                              </button>
                              <button
                                className="edit-btn"
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditingClone({ index: globalIndex, entry });
                                  setEditCloneName(entry.customName || '');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="clone-btn"
                                onClick={e => cloneSession(e, session)}
                              >
                                Clone
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Memory — Flat scrollable list of all .md files */}
      {filter === 'memory' && (
        <div className="memory-view">
          <div className="memory-paths-header">
            <div className="memory-add-row">
              <button className="action-btn clone-btn" onClick={browseAndAddPath}>+ Add Folder</button>
            </div>
          </div>

          {memoryPaths.length === 0 ? (
            <div className="empty-state">
              <div className="icon">MD</div>
              <h3>No memory paths added</h3>
              <p>Add folder paths above to browse .md files</p>
            </div>
          ) : (
            <div className="rules-tree">
              {memoryPaths.map(rootPath => {
                const data = memoryFiles[rootPath];
                const files = data ? data.files : [];
                const rootName = data ? data.rootName : rootPath.split('/').pop();

                return (
                  <div key={rootPath} className="rules-root">
                    <div className="rules-root-header">
                      <div className="rules-root-info">
                        <span className="rules-root-name">{rootName}</span>
                        <span className="rules-root-path">{rootPath}</span>
                      </div>
                      <button
                        className="rules-remove-btn always-visible"
                        onClick={() => removeMemoryPath(rootPath)}
                        title="Remove folder"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="rules-root-children">
                      {files.length === 0 ? (
                        <div className="rules-empty">No .md files found</div>
                      ) : files.map(file => (
                        <div
                          key={file.path}
                          className="rules-item"
                          onClick={() => openMemoryFile(file.path)}
                        >
                          <div className="rules-item-header">
                            <div className="rules-item-info">
                              <span className="rules-item-title">{file.title || file.name}</span>
                              {file.description && (
                                <span className="rules-item-desc">{file.description}</span>
                              )}
                              {file.links && file.links.length > 0 && (
                                <div className="rules-item-links-hint">
                                  {file.links.length} linked {file.links.length === 1 ? 'file' : 'files'}
                                </div>
                              )}
                            </div>
                            <span className="rules-item-size">{(file.size / 1024).toFixed(1)}KB</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      {filter === 'history' || filter === 'memory' ? null : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            {search || filter !== 'all' ? '?' : '[]'}
          </div>
          <h3>
            {search || filter !== 'all'
              ? 'No matching sessions'
              : 'No Claude Code sessions found'}
          </h3>
          <p>
            {search || filter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Sessions will appear here once you use Claude Code'}
          </p>
        </div>
      ) : (
        <div className="session-list">
          {filtered.map(session => (
            <div
              key={session.id}
              className={`session-card ${activeSessionIds.includes(session.id) ? 'active' : ''}`}
              onDoubleClick={() => cloneSession(null, session)}
            >
              <button
                className={`star-btn ${session.starred ? 'starred' : ''}`}
                onClick={e => toggleStar(e, session)}
                title={session.starred ? 'Unstar' : 'Star this session'}
              >
                {session.starred ? '\u2605' : '\u2606'}
              </button>

              <div className="session-info">
                <div className="session-header">
                  <span className="session-name">
                    {session.customName || session.sessionName || truncate(session.firstUserMessage, 60) || session.id.slice(0, 8)}
                  </span>
                  {activeSessionIds.includes(session.id) && (
                    <span className="active-badge" title="Running in terminal"><span className="active-dot" />LIVE</span>
                  )}
                </div>
                <div className="session-meta">
                  <span className="project-badge" title={session.projectPath}>
                    {projectName(session.projectPath)}
                  </span>
                  <span>{session.messageCount} messages</span>
                  <span>{timeAgo(session.updatedAt)}</span>
                </div>
              </div>

              <div className="session-actions">
                <button
                  className="summary-btn"
                  onClick={e => getCompactSummary(e, session)}
                  title="View session summary"
                  disabled={summaryLoading}
                >
                  Summary
                </button>
                <button
                  className="summary-btn ai"
                  onClick={e => getAiSummary(e, session)}
                  title="Generate AI summary"
                  disabled={summaryLoading}
                >
                  AI Summary
                </button>
                <button
                  className="edit-btn"
                  onClick={e => openEditModal(e, session)}
                  title="Name or describe this session"
                >
                  Edit
                </button>
                <button
                  className="clone-btn"
                  onClick={e => cloneSession(e, session)}
                  title="Open this session in a new terminal"
                >
                  Clone
                </button>
              </div>
            </div>
          ))}
        </div>
      )}


      {/* Edit Modal */}
      {editingSession && (
        <div className="edit-modal-overlay" onClick={() => setEditingSession(null)}>
          <div className="edit-modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Session</h3>
            <label>Name</label>
            <input
              type="text"
              placeholder="Give this session a name..."
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
            />
            <label>Description</label>
            <textarea
              placeholder="Add a description or notes..."
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
            />
            <div className="edit-modal-actions">
              <button className="cancel-btn" onClick={() => setEditingSession(null)}>
                Cancel
              </button>
              <button className="save-btn" onClick={saveSessionMeta}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="edit-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="edit-modal" onClick={e => e.stopPropagation()}>
            <h3>Settings</h3>
            <label>Terminal Application</label>
            <div className="terminal-options">
              {getTerminalOptions(platform).map(opt => (
                <button
                  key={opt.value}
                  className={`terminal-option ${settings.terminal === opt.value ? 'active' : ''}`}
                  onClick={() => updateSettings({ terminal: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label style={{ marginTop: 8 }}>Startup</label>
            <div
              className={`terminal-option ${settings.launchOnStartup ? 'active' : ''}`}
              onClick={() => updateSettings({ launchOnStartup: !settings.launchOnStartup })}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 4,
                border: `2px solid ${settings.launchOnStartup ? 'var(--primary)' : 'var(--border)'}`,
                background: settings.launchOnStartup ? 'var(--primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'white', flexShrink: 0,
              }}>
                {settings.launchOnStartup ? '\u2713' : ''}
              </span>
              Launch on system startup
            </div>
            <div
              className={`terminal-option ${settings.screenshotClipboard !== false ? 'active' : ''}`}
              onClick={() => updateSettings({ screenshotClipboard: settings.screenshotClipboard === false ? true : false })}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 4,
                border: `2px solid ${settings.screenshotClipboard !== false ? 'var(--primary)' : 'var(--border)'}`,
                background: settings.screenshotClipboard !== false ? 'var(--primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'white', flexShrink: 0,
              }}>
                {settings.screenshotClipboard !== false ? '\u2713' : ''}
              </span>
              Copy screenshot path to clipboard
            </div>
            <label style={{ marginTop: 8 }}>Appearance</label>
            <div className="terminal-options">
              {[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`terminal-option ${settings.theme === opt.value ? 'active' : ''}`}
                  onClick={() => updateSettings({ theme: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label style={{ marginTop: 8 }}>Claude API Key (for AI Summaries)</label>
            <input
              type="password"
              placeholder="sk-ant-..."
              defaultValue={settings.claudeApiKey || ''}
              onBlur={e => {
                if (e.target.value !== (settings.claudeApiKey || '')) {
                  updateSettings({ claudeApiKey: e.target.value });
                }
              }}
              style={{ marginBottom: 8 }}
            />
            <label style={{ marginTop: 8 }}>Updates</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="terminal-option"
                onClick={checkForUpdates}
                disabled={checkingUpdate}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
              >
                {checkingUpdate ? 'Checking...' : 'Check for Updates'}
                {updateInfo && !updateInfo.hasUpdate && (
                  <span style={{ marginLeft: 'auto', color: 'var(--success)', fontSize: 12 }}>
                    Up to date
                  </span>
                )}
              </button>
              {updateInfo?.hasUpdate && (
                <div style={{
                  padding: '12px 16px', background: 'var(--primary-glow)',
                  border: '1px solid var(--border-active)', borderRadius: 'var(--radius)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {updateInfo.commitCount} new commit{updateInfo.commitCount !== 1 ? 's' : ''} available
                  </div>
                  {updateInfo.commits && updateInfo.commits.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontFamily: 'monospace' }}>
                      {updateInfo.commits.map((c, i) => <div key={i}>{c}</div>)}
                    </div>
                  )}
                  <button
                    className="save-btn"
                    onClick={applyUpdate}
                    disabled={checkingUpdate}
                    style={{ fontSize: 13, cursor: 'pointer' }}
                  >
                    {checkingUpdate ? 'Updating...' : 'Apply Update'}
                  </button>
                </div>
              )}
            </div>
            <div className="edit-modal-actions" style={{ marginTop: 20 }}>
              <button className="save-btn" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Session FAB */}
      <div className="fab-container">
        {showProjectPicker && (
          <div className="project-picker">
            {(() => {
              const seen = new Set();
              const paths = sessions
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                .filter(s => {
                  if (!s.projectPath || seen.has(s.projectPath)) return false;
                  seen.add(s.projectPath);
                  return true;
                })
                .map(s => s.projectPath)
                .slice(0, 8);
              return (
                <>
                  {paths.map(p => (
                    <button
                      key={p}
                      className="project-picker-item"
                      onClick={async () => {
                        setShowProjectPicker(false);
                        try {
                          const res = await fetch('/api/new-session', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectPath: p }),
                          });
                          const data = await res.json();
                          if (data.success) showToast(`New session in ${projectName(p)}`, 'success');
                          else showToast('Failed to launch session', 'error');
                        } catch { showToast('Failed to launch session', 'error'); }
                      }}
                    >
                      <span className="picker-folder-icon">📁</span>
                      <span className="picker-path">{projectName(p)}</span>
                      <span className="picker-full-path" title={p}>{p}</span>
                    </button>
                  ))}
                  <button
                    className="project-picker-item picker-no-folder"
                    onClick={async () => {
                      setShowProjectPicker(false);
                      try {
                        const res = await fetch('/api/new-session', { method: 'POST' });
                        const data = await res.json();
                        if (data.success) showToast(`New session opened in ${data.terminal}`, 'success');
                        else showToast('Failed to launch session', 'error');
                      } catch { showToast('Failed to launch session', 'error'); }
                    }}
                  >
                    <span className="picker-folder-icon">✨</span>
                    <span className="picker-path">No folder (home directory)</span>
                  </button>
                </>
              );
            })()}
          </div>
        )}
        <button
          className="fab-new-session"
          onClick={() => setShowProjectPicker(prev => !prev)}
          title="Launch new Claude session"
        >
          +
        </button>
      </div>
      {/* Clone Edit Modal */}
      {editingClone && (
        <div className="edit-modal-overlay" onClick={() => setEditingClone(null)}>
          <div className="edit-modal" onClick={e => e.stopPropagation()}>
            <h3>Name this clone</h3>
            <label>Name</label>
            <input
              value={editCloneName}
              onChange={e => setEditCloneName(e.target.value)}
              placeholder="Give this clone a name..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && saveCloneEdit()}
            />
            <div className="edit-modal-actions">
              <button className="cancel-btn" onClick={() => setEditingClone(null)}>
                Cancel
              </button>
              <button className="save-btn" onClick={saveCloneEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

            {showProjectPicker && <div className="picker-backdrop" onClick={() => setShowProjectPicker(false)} />}

      {/* Info Modal */}
      {showInfo && (
        <div className="edit-modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="edit-modal info-modal" onClick={e => e.stopPropagation()}>
            <h3>Install Claude Code</h3>
            <div className="info-content">
              <p><strong>1. Install via npm</strong></p>
              <code className="info-code">npm install -g @anthropic-ai/claude-code</code>
              <p><strong>2. Run it</strong></p>
              <code className="info-code">claude</code>
              <p><strong>3. Authenticate</strong></p>
              <p>Follow the prompts to sign in with your Anthropic account or API key.</p>
              <p><strong>4. Start using</strong></p>
              <p>Navigate to any project folder and run <code>claude</code> to start a session. Your sessions will appear here automatically.</p>
              <div className="info-links">
                <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener">Documentation</a>
                <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener">GitHub</a>
              </div>
            </div>
            <button className="save-btn" onClick={() => setShowInfo(false)}>Got it</button>
          </div>
        </div>
      )}

      {/* Summary Modal */}
      {summaryModal && (
        <div className="edit-modal-overlay" onClick={() => setSummaryModal(null)}>
          <div className="edit-modal summary-modal" onClick={e => e.stopPropagation()}>
            <h3>{summaryModal.title}</h3>
            <div className="summary-text">
              {summaryModal.loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                  <div className="spinner" />
                  <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Generating...</p>
                </div>
              ) : (
                summaryModal.text
              )}
            </div>
            <div className="edit-modal-actions">
              <button className="cancel-btn" onClick={() => setSummaryModal(null)}>
                Close
              </button>
              {!summaryModal.loading && (
                <button className="save-btn" onClick={copySummary}>
                  Copy to Clipboard
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '\u2713' : toast.type === 'error' ? '\u2717' : 'i'}
          {' '}{toast.message}
        </div>
      )}
    </div>
  );
}
