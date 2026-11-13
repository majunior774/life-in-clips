import { useState } from 'react';
import { ErrorBanner } from './ui.jsx';

/** Shown when the backend answers 401: asks for the shared access key (the backend's ACCESS_KEY). */
export default function AccessGate({ message, onSubmit }) {
  const [key, setKey] = useState('');
  const wrong = message?.toLowerCase().includes('incorrect');

  return (
    <div className="mx-auto max-w-md py-16">
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) onSubmit(key.trim());
        }}
      >
        <div>
          <p className="eyebrow">Private workspace</p>
          <h2 className="font-display text-2xl">Enter your access key</h2>
          <p className="mt-1 text-sm text-muted">
            This app is protected. Use the <code>ACCESS_KEY</code> configured on the backend. It is stored only in this browser.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="access-key">Access key</label>
          <input
            id="access-key"
            type="password"
            className="input"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
            required
          />
        </div>
        {wrong && <ErrorBanner message={message} />}
        <button type="submit" className="btn btn-primary w-full" disabled={!key.trim()}>Unlock</button>
      </form>
    </div>
  );
}
