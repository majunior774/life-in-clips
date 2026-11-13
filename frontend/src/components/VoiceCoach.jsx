import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceSession } from '../hooks/useVoiceSession.js';
import { api } from '../lib/api.js';
import { ErrorBanner, Spinner } from './ui.jsx';
import ProposalCard from './ProposalCard.jsx';

/**
 * Voice coach panel. Owns the voice session and the list of pending (unsaved) proposals.
 * Persistence happens only via `onApprove`, after the user presses Approve.
 */
export default function VoiceCoach({ voiceConfigured, busy, onApprove }) {
  const [proposals, setProposals] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const logRef = useRef(null);
  const nextId = useRef(1);

  const handleProposal = useCallback(async (args) => {
    try {
      const valid = await api.validateProposal(args);
      setProposals((p) => [...p, { id: nextId.current++, data: valid }]);
      return {
        ok: true,
        message: 'The plan is now shown on screen for the user to review. It is NOT saved until they approve it. Tell them to review it.',
      };
    } catch (err) {
      return { ok: false, message: `The proposal was invalid and was not shown: ${err.message} Fix it and call propose_plan again.` };
    }
  }, []);

  const voice = useVoiceSession({ onProposal: handleProposal });
  const connected = voice.status === 'connected';
  const connecting = voice.status === 'connecting';
  const unavailable = voiceConfigured === false;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [voice.transcript]);

  async function approve(p) {
    setApprovingId(p.id);
    const movie = await onApprove(p.data);
    setApprovingId(null);
    if (movie) {
      setProposals((list) => list.filter((x) => x.id !== p.id));
      if (connected) voice.notify(`The user approved the plan "${p.data.movie.title}" and it is now saved.`);
    }
  }

  function reject(p) {
    setProposals((list) => list.filter((x) => x.id !== p.id));
    if (connected) voice.notify(`The user rejected the plan "${p.data.movie.title}". Ask what they would change.`);
  }

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
