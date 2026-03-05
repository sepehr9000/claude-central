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
  const [settings, setSettings] = useState({ terminal: 'default', launchOnStartup: false, theme: 'dark' });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [summaryModal, setSummaryModal] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    fetchSessions();
    fetchSettings();
  }, []);

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
        showToast(`You're on the latest version (v${data.currentVersion})`, 'success');
      }
    } catch {
      showToast('Failed to check for updates', 'error');
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
        body: JSON.stringify({ projectPath: session.projectPath }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Opened in ${data.terminal}`, 'success');
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

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const projects = useMemo(() => {
    const set = new Set(sessions.map(s => projectName(s.projectPath)));
    return [...set].sort();
  }, [sessions]);

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
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
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
      </div>

      {/* Session list */}
      {filtered.length === 0 ? (
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
              className="session-card"
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
              {[
                { value: 'default', label: 'Default (Terminal.app)' },
                { value: 'iterm2', label: 'iTerm2' },
                { value: 'warp', label: 'Warp' },
              ].map(opt => (
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
            <label style={{ marginTop: 8 }}>Claude API Key</label>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={settings.claudeApiKey || ''}
              onChange={e => updateSettings({ claudeApiKey: e.target.value })}
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
                    v{updateInfo.currentVersion} (latest)
                  </span>
                )}
              </button>
              {updateInfo?.hasUpdate && (
                <div style={{
                  padding: '12px 16px', background: 'var(--primary-glow)',
                  border: '1px solid var(--border-active)', borderRadius: 'var(--radius)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    v{updateInfo.latestVersion} available
                  </div>
                  {updateInfo.releaseNotes && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {updateInfo.releaseNotes.slice(0, 200)}
                    </div>
                  )}
                  <a
                    href={updateInfo.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="save-btn"
                    style={{ textDecoration: 'none', display: 'inline-block', fontSize: 13 }}
                  >
                    Download Update
                  </a>
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
