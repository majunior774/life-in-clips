import { useEffect, useState } from 'react';
import { useWorkspace } from './hooks/useWorkspace.js';
import { api } from './lib/api.js';
import MovieSidebar from './components/MovieSidebar.jsx';
import MovieDetail from './components/MovieDetail.jsx';
import TodaysFocus from './components/TodaysFocus.jsx';
import VoiceCoach from './components/VoiceCoach.jsx';
import AccessGate from './components/AccessGate.jsx';
import { ErrorBanner, Spinner } from './components/ui.jsx';
import { clearAccessKey, getAccessKey, setAccessKey } from './lib/auth.js';

function useHealth() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let live = true;
    api
      .health()
      .then((h) => live && setHealth(h))
      .catch(() => live && setHealth({ unreachable: true }));
    return () => {
      live = false;
    };
  }, []);
  return health;
}

function Brand({ health, saving, onLock }) {
  const db = health?.database;
  const dbOk = db?.reachable;
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="9" width="20" height="14" rx="2" fill="none" stroke="#e8a838" strokeWidth="2" /><path d="M13 12.5v7l6-3.5z" fill="#e8a838" /></svg>
          <h1 className="font-display text-xl tracking-tight sm:text-2xl">Life in Clips</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {onLock && <button className="btn btn-ghost btn-sm" onClick={onLock}>Lock</button>}
          {saving && <span className="flex items-center gap-2"><Spinner label="Saving" />Saving…</span>}
          {health && (
            <span title={health.unreachable ? 'API unreachable' : `Database: ${db?.state}`} className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${health.unreachable ? 'bg-bad' : dbOk ? 'bg-good' : 'bg-bad'}`} />
              {health.unreachable ? 'API offline' : dbOk ? 'Database connected' : 'Database offline'}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const ws = useWorkspace();
  const health = useHealth();
  const focusIds = new Set(ws.focus.clips.map((c) => c.id));
  const voiceConfigured = health && !health.unreachable ? health.voice?.configured : null;

  return (
    <div className="min-h-screen">
      <Brand
        health={health}
        saving={ws.saving}
        onLock={getAccessKey() ? () => { clearAccessKey(); ws.reload(); } : null}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {ws.authError !== null ? (
          <AccessGate
            message={ws.authError}
            onSubmit={(key) => {
              setAccessKey(key);
              ws.reload();
            }}
          />
        ) : ws.loading ? (
          <div className="flex items-center justify-center gap-3 py-24 text-muted"><Spinner label="Loading workspace" />Loading your movies…</div>
        ) : ws.loadError ? (
          <div className="mx-auto max-w-xl space-y-3 py-16">
            <h2 className="font-display text-2xl">Could not load your workspace</h2>
            <ErrorBanner message={ws.loadError} onRetry={ws.reload} />
            <p className="text-sm text-muted">Check that the API is running and that MongoDB Atlas is reachable (see the README troubleshooting section).</p>
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorBanner message={ws.actionError} onDismiss={ws.dismissError} />
            <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
              <MovieSidebar movies={ws.movies} selectedId={ws.selectedId} onSelect={ws.selectMovie} onCreate={ws.createMovie} busy={ws.saving} />
              <div className="min-w-0 space-y-6">
                <div className="grid gap-6 xl:grid-cols-2">
                  <VoiceCoach voiceConfigured={voiceConfigured} busy={ws.saving} onApprove={ws.applyProposal} />
                  <TodaysFocus
                    focus={ws.focus}
                    busy={ws.saving}
                    onToggleFocus={ws.toggleFocus}
                    onToggleDone={(clip) => ws.updateClip(clip.id, { status: clip.status === 'completed' ? 'todo' : 'completed' })}
                  />
                </div>
                <MovieDetail movie={ws.detail} focusIds={focusIds} focusMax={ws.focus.max} ws={ws} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
