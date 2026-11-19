import { Router } from 'express';
import * as svc from './services.js';
import * as schemas from './lib/schemas.js';
import { HttpError } from './lib/errors.js';
import { dbStatus } from './lib/db.js';
import { config } from './config.js';
import { GoogleGenAI } from '@google/genai';
import { buildLiveConfig } from './coach.js';
import { createLimiter, limitRequests } from './lib/rateLimit.js';
import { log } from './lib/logger.js';

export const api = Router();

const voiceLimit = limitRequests(
  createLimiter({ windowMs: 10 * 60 * 1000, max: 20 }),
  'Too many voice sessions started. Wait a few minutes and try again.',
);

/* ----------------------------- Health ----------------------------- */
// `server` is always "ok" if this responds; `database` reports Atlas connectivity separately.
api.get('/health', async (req, res) => {
  const database = await dbStatus(req.requestId);
  res.status(database.reachable ? 200 : 503).json({
    server: { status: 'ok', uptimeSeconds: Math.round(process.uptime()) },
    database,
    voice: { provider: 'gemini', configured: Boolean(config.geminiApiKey) },
    auth: { required: Boolean(config.accessKey) },
  });
});

/* ----------------------------- Movies ----------------------------- */
api.get('/movies', async (_req, res) => res.json({ movies: await svc.listMovies() }));

api.post('/movies', async (req, res) => {
  const data = schemas.movieCreate.parse(req.body);
  res.status(201).json({ movie: await svc.createMovie(data) });
});

api.get('/movies/:id', async (req, res) => res.json({ movie: await svc.getMovie(req.params.id) }));

api.patch('/movies/:id', async (req, res) => {
  const data = schemas.movieUpdate.parse(req.body);
  res.json({ movie: await svc.updateMovie(req.params.id, data) });
});

api.delete('/movies/:id', async (req, res) => {
  await svc.deleteMovie(req.params.id);
  res.status(204).end();
});

/* ------------------------------ Clips ------------------------------ */
api.post('/movies/:id/clips', async (req, res) => {
  const data = schemas.clipCreate.parse(req.body);
  res.status(201).json({ clip: await svc.createClip(req.params.id, data) });
});

api.patch('/clips/:id', async (req, res) => {
  const data = schemas.clipUpdate.parse(req.body);
  res.json({ clip: await svc.updateClip(req.params.id, data) });
});

api.delete('/clips/:id', async (req, res) => {
  await svc.deleteClip(req.params.id);
  res.status(204).end();
});

/* ------------------------------ Focus ------------------------------ */
api.get('/focus', async (req, res) => {
  const date = schemas.focusUpdate.shape.date.parse(req.query.date);
  res.json({ focus: await svc.getFocus(date) });
});

api.put('/focus', async (req, res) => {
  const { date, clipIds } = schemas.focusUpdate.parse(req.body);
  res.json({ focus: await svc.setFocus(date, clipIds) });
});

/* --------------------- AI proposals (approval gate) --------------------- */
// Dry-run validation: lets the UI (and the coach, via the tool result) learn about a bad
// proposal immediately. Saves nothing.
api.post('/proposals/validate', (req, res) => {
  res.json({ proposal: schemas.proposal.parse(req.body) });
});

// The ONLY path by which AI-originated changes reach the database, and only when the
// frontend posts a proposal after the user clicked Approve. Re-validated here.
api.post('/proposals/apply', async (req, res) => {
  const proposal = schemas.proposal.parse(req.body);
  res.status(201).json({ movie: await svc.applyProposal(proposal) });
});

/* --------------------------- Voice credentials --------------------------- */
// Mints a single-use, short-lived Gemini Live token. The permanent GEMINI_API_KEY never leaves
// the server, and the session config (instructions + tools) is locked into the token.
api.post('/voice/session', voiceLimit, async (req, res) => {
  if (!config.geminiApiKey) {
    throw new HttpError(503, 'GEMINI_API_KEY is not configured on the server, so voice is unavailable.');
  }
  const today = new Date().toISOString().slice(0, 10);
  // The coach can still run without the workspace snapshot, so a failure here is non-fatal.
  const summary = await svc.workspaceSummary().catch((err) => {
    log('warn', 'voice.workspace_summary_failed', {
      requestId: req.requestId,
      errorName: err?.name,
      message: err?.message,
    });
    return '';
  });
  const liveConfig = buildLiveConfig(summary, today);
  const apiVersion = config.geminiApiVersion;
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  let token;
  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { apiVersion } });
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: { model: config.geminiLiveModel, config: liveConfig },
        httpOptions: { apiVersion },
      },
    });
  } catch (err) {
    // Never forward the upstream message: it can contain request details.
    const status = Number(err?.status);
    log('error', 'voice.token_request_failed', { requestId: req.requestId, status: status || undefined, errorName: err?.name });
    if (status === 400 || status === 404) {
      throw new HttpError(
        502,
        `Gemini rejected the voice session request (HTTP ${status}). Check GEMINI_LIVE_MODEL ("${config.geminiLiveModel}") and GEMINI_API_VERSION ("${apiVersion}").`,
      );
    }
    if (status === 401 || status === 403) {
      throw new HttpError(502, 'Gemini rejected GEMINI_API_KEY (invalid, restricted, or Live API not enabled for it).');
    }
    if (status === 429) throw new HttpError(502, 'Gemini rate limit or quota reached. Try again shortly.');
    throw new HttpError(502, 'Could not reach the Gemini API. Check your internet connection.');
  }

  if (!token?.name) throw new HttpError(502, 'Gemini returned no ephemeral token.');
  res.json({
    token: token.name,
    model: config.geminiLiveModel,
    apiVersion,
    config: liveConfig,
    expiresAt: expireTime,
  });
});
