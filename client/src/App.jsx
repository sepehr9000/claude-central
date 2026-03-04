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
  const [filter, setFilter] = useState('all'); // 'all', 'starred', project name
  const [selectedSession, setSelectedSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchSessions();
  }, []);

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
    e.stopPropagation();
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

  async function viewSession(session) {
    setSelectedSession(session);
    setLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/sessions/${session.id}/messages?projectDir=${encodeURIComponent(session.projectDir)}`
      );
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      showToast('Failed to load messages', 'error');
    } finally {
      setLoadingMessages(false);
    }
  }

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  // Gather unique project names for filter
  const projects = useMemo(() => {
    const set = new Set(sessions.map(s => projectName(s.projectPath)));
    return [...set].sort();
  }, [sessions]);

  // Filter & search
  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (filter === 'starred' && !s.starred) return false;
      if (filter !== 'all' && filter !== 'starred' && projectName(s.projectPath) !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = [
          s.firstUserMessage,
          s.sessionName,
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
        <div className="loading">
          <div className="spinner" />
          <p style={{ marginTop: 12 }}>Loading sessions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <h1>
          <span className="logo">C</span>
          Claude Session Manager
        </h1>
        <span className="session-count">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} found
        </span>
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
        {projects.map(p => (
          <button
            key={p}
            className={`filter-btn ${filter === p ? 'active' : ''}`}
            onClick={() => setFilter(filter === p ? 'all' : p)}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Session list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            {search || filter !== 'all' ? '🔍' : '📂'}
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
              className={`session-card ${selectedSession?.id === session.id ? 'selected' : ''}`}
              onClick={() => viewSession(session)}
            >
              <button
                className={`star-btn ${session.starred ? 'starred' : ''}`}
                onClick={e => toggleStar(e, session)}
                title={session.starred ? 'Unstar' : 'Star this session'}
              >
                {session.starred ? '★' : '☆'}
              </button>

              <div className="session-info">
                <div className="session-header">
                  <span className="session-name">
                    {session.sessionName || truncate(session.firstUserMessage, 60) || session.id.slice(0, 8)}
                  </span>
                </div>
                {session.firstUserMessage && !session.sessionName && (
                  <div className="session-preview">
                    {truncate(session.firstUserMessage, 120)}
                  </div>
                )}
                {session.sessionName && session.firstUserMessage && (
                  <div className="session-preview">
                    {truncate(session.firstUserMessage, 120)}
                  </div>
                )}
                <div className="session-meta">
                  <span className="project-badge" title={session.projectPath}>
                    {projectName(session.projectPath)}
                  </span>
                  <span>{session.messageCount} messages</span>
                  <span>{timeAgo(session.updatedAt)}</span>
                  {session.model && <span>{session.model}</span>}
                </div>
              </div>

              <div className="session-actions">
                <button
                  className="clone-btn"
                  onClick={e => cloneSession(e, session)}
                  title="Open this session in a new terminal"
                >
                  ⎘ Clone
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedSession && (
        <>
          <div className="overlay" onClick={() => setSelectedSession(null)} />
          <div className="detail-panel">
            <div className="detail-header">
              <h2>
                {selectedSession.sessionName ||
                  truncate(selectedSession.firstUserMessage, 40) ||
                  selectedSession.id.slice(0, 8)}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="clone-btn"
                  onClick={e => cloneSession(e, selectedSession)}
                >
                  ⎘ Clone
                </button>
                <button
                  className="close-btn"
                  onClick={() => setSelectedSession(null)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="detail-body">
              {loadingMessages ? (
                <div className="loading">
                  <div className="spinner" />
                </div>
              ) : messages.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  No messages found
                </p>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`message ${msg.role}`}>
                    <div className="message-role">
                      {msg.role === 'user' ? 'You' : 'Claude'}
                    </div>
                    <div className="message-content">
                      {truncate(msg.content, 2000)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          {toast.message}
        </div>
      )}
    </div>
  );
}
