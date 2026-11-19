import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceSession } from '../hooks/useVoiceSession.js';
import { api } from '../lib/api.js';
import { runCoachTool } from '../lib/coachTools.js';
import { ErrorBanner, Spinner } from './ui.jsx';
import ProposalCard from './ProposalCard.jsx';

/**
 * Voice coach panel. Owns the voice session, pending (unsaved) plans, delete confirmations and
 * the activity log. The coach may act on existing data only through runCoachTool (validated REST
 * calls); new plans and deletes always wait for the user, and every action can be seen here.
 */
export default function VoiceCoach({ voiceConfigured, busy, ws }) {
  const [proposals, setProposals] = useState([]);
  const [deletions, setDeletions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const logRef = useRef(null);
  const nextId = useRef(1);
  const ctxRef = useRef(null);
  // Source of truth for waiting plans, updated synchronously so a spoken "approve" right after a
  // proposal sees it before React re-renders.
  const pendingRef = useRef([]);
  const updatePending = useCallback((fn) => {
    pendingRef.current = fn(pendingRef.current);
    setProposals(pendingRef.current);
  }, []);

  const addActivity = useCallback((entry) => {
    setActivity((list) => [{ id: nextId.current++, undone: false, ...entry }, ...list].slice(0, 8));
  }, []);

  const handleToolCall = useCallback((name, args) => runCoachTool(name, args, ctxRef.current), []);
  const voice = useVoiceSession({ onToolCall: handleToolCall });
  const connected = voice.status === 'connected';
  const connecting = voice.status === 'connecting';
  const unavailable = voiceConfigured === false;

  const tellCoach = useCallback((text) => {
    if (voice.status === 'connected') voice.notify(text);
  }, [voice]);

  async function approve(p, { silent } = {}) {
    setApprovingId(p.id);
    const movie = await ws.applyProposal(p.data);
    setApprovingId(null);
    if (!movie) return { ok: false, message: 'Saving failed. The error is shown on screen.' };
    updatePending((list) => list.filter((x) => x.id !== p.id));
    addActivity({ text: `Saved plan "${p.data.movie.title}" (${p.data.clips.length} clips)` });
    if (!silent) tellCoach(`The user approved the plan "${p.data.movie.title}" and it is now saved.`);
    return { ok: true, message: `Saved plan "${p.data.movie.title}".` };
  }

  function reject(p, { silent } = {}) {
    updatePending((list) => list.filter((x) => x.id !== p.id));
    if (!silent) tellCoach(`The user rejected the plan "${p.data.movie.title}". Ask what they would change.`);
    return { ok: true, message: `Discarded plan "${p.data.movie.title}".` };
  }

  /** Which pending plan does a spoken request mean? */
  function pickPlan(title) {
    const list = pendingRef.current;
    if (!list.length) return { error: 'No plan is waiting on screen.' };
    if (list.length === 1) return { plan: list[0] };
    const hits = title ? list.filter((p) => p.data.movie.title.toLowerCase().includes(title.toLowerCase())) : [];
    if (hits.length === 1) return { plan: hits[0] };
    return { error: `Several plans are waiting (${list.map((p) => `"${p.data.movie.title}"`).join(', ')}). Ask the user which one.` };
  }

  async function confirmDelete(d) {
    setDeletions((list) => list.filter((x) => x.id !== d.id));
    const r = await ws.perform(() => (d.kind === 'movie' ? api.deleteMovie(d.id) : api.deleteClip(d.id)), d.kind === 'clip' ? undefined : null);
    if (r.ok) addActivity({ text: `Deleted ${d.kind} "${d.label}"` });
    tellCoach(r.ok ? `The user confirmed and the ${d.kind} "${d.label}" was deleted.` : `Deleting "${d.label}" failed: ${r.message}`);
  }

  function keepDeletion(d) {
    setDeletions((list) => list.filter((x) => x.id !== d.id));
    tellCoach(`The user chose to keep the ${d.kind} "${d.label}". Nothing was deleted.`);
  }

  async function undo(entry) {
    setActivity((list) => list.map((a) => (a.id === entry.id ? { ...a, undone: true } : a)));
    const r = await entry.undo();
    if (r?.ok === false) setActivity((list) => list.map((a) => (a.id === entry.id ? { ...a, undone: false, error: r.message } : a)));
    else tellCoach(`The user undid: ${entry.text}.`);
  }

  // Latest closures for the tool runner (the voice hook keeps one stable callback).
  useEffect(() => {
    ctxRef.current = {
      api,
      perform: ws.perform,
      log: addActivity,
      proposePlan: async (args) => {
        try {
          const valid = await api.validateProposal(args);
          updatePending((p) => [...p, { id: nextId.current++, data: valid }]);
          return { ok: true, message: 'The plan is now shown on screen for the user to review. It is NOT saved until they approve it (by clicking, or by telling you to approve it). Tell them to review it.' };
        } catch (err) {
          return { ok: false, message: `The proposal was invalid and was not shown: ${err.message} Fix it and call propose_plan again.` };
        }
      },
      plans: {
        approve: async (title) => {
          const { plan, error } = pickPlan(title);
          return error ? { ok: false, message: error } : approve(plan, { silent: true });
        },
        reject: async (title) => {
          const { plan, error } = pickPlan(title);
          return error ? { ok: false, message: error } : reject(plan, { silent: true });
        },
      },
      requestDelete: (d) => setDeletions((list) => [...list, { id: nextId.current++, ...d }]),
    };
  });

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [voice.transcript]);

  const stateLabel = connecting
    ? 'Connecting…'
    : connected
      ? voice.coachSpeaking
        ? 'Coach is speaking'
        : voice.userSpeaking
          ? 'Listening to you'
          : voice.muted
            ? 'Microphone muted'
            : 'Connected · speak any time'
      : 'Not connected';

  return (
    <section aria-label="AI voice coach" className="card overflow-hidden">
      <div className="border-b border-line bg-gradient-to-r from-accent-soft to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Accountability coach</p>
            <h2 className="font-display text-2xl">Talk it through</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-good' : connecting ? 'bg-accent' : 'bg-line'}`} />
              {stateLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <button className="btn" onClick={voice.toggleMute}>{voice.muted ? 'Unmute mic' : 'Mute mic'}</button>
            )}
            {connected || connecting ? (
              <button className="btn btn-danger" onClick={voice.disconnect}>{connecting ? 'Cancel' : 'End session'}</button>
            ) : (
              <button
                className={`btn btn-primary px-5 py-2.5 text-base ${!unavailable ? 'pulse' : ''}`}
                onClick={voice.connect}
                disabled={unavailable}
              >
                {voice.status === 'error' ? 'Reconnect' : 'Start talking'}
              </button>
            )}
            {connecting && <Spinner label="Connecting to voice coach" />}
          </div>
        </div>

        {unavailable && (
          <p className="mt-3 rounded-lg border border-line bg-ink/60 p-3 text-sm text-muted">
            Voice is unavailable: <code>GEMINI_API_KEY</code> is not set on the server. Add it to <code>.env</code> and restart. The rest of the app works without it.
          </p>
        )}
        {voice.error && <div className="mt-3"><ErrorBanner message={voice.error} /></div>}
      </div>

      <div className="space-y-4 p-5">
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p.data} busy={busy || approvingId === p.id} onApprove={() => approve(p)} onReject={() => reject(p)} />
        ))}

        {deletions.map((d) => (
          <div key={d.id} role="group" aria-label={`Confirm delete ${d.label}`} className="rounded-xl border border-bad/50 bg-bad/10 p-4">
            <p className="eyebrow !text-bad">Coach asks to delete · needs your click</p>
            <p className="mt-1">Delete {d.kind} <strong>"{d.label}"</strong>{d.kind === 'movie' ? ' and all its clips' : ''}? This cannot be undone.</p>
            <div className="mt-3 flex gap-2">
              <button className="btn btn-danger" disabled={busy} onClick={() => confirmDelete(d)}>Delete</button>
              <button className="btn" onClick={() => keepDeletion(d)}>Keep it</button>
            </div>
          </div>
        ))}

        {activity.length > 0 && (
          <div aria-label="Coach activity">
            <p className="eyebrow mb-1">Coach activity</p>
            <ul className="space-y-1">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className={a.undone ? 'text-muted line-through' : ''}>✓ {a.text}</span>
                  {a.error && <span className="text-xs text-bad">Undo failed: {a.error}</span>}
                  {a.undo && !a.undone && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => undo(a)}>Undo</button>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div ref={logRef} role="log" aria-label="Conversation transcript" className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {voice.transcript.length === 0 ? (
            <p className="text-sm text-muted">
              {connected
                ? 'Say what you want to achieve. Brain-dumps are welcome: the coach will ask questions and propose a plan.'
                : 'Try: "I need to update my resume, build a portfolio and practise DSA daily. Help me prioritise without overloading my week."'}
            </p>
          ) : (
            voice.transcript.map((t) => (
              <p key={t.id} className={`text-sm ${t.role === 'coach' ? 'text-text' : 'text-muted'}`}>
                <span className="mr-2 text-[0.65rem] font-bold uppercase tracking-wider text-accent">{t.role === 'coach' ? 'Coach' : 'You'}</span>
                {t.text}
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
