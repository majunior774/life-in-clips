# AGENTS.md — Life in Clips

Persistent context for coding agents. User-facing docs live in `README.md`; do not duplicate them here.

**Before changing anything:** inspect the repo (`ls`, `package.json`, `git log`/`git status`), read the files you will touch, and run `npm run lint && npm test && npm run build`. **After meaningful progress, update this file** (implemented / blocked / bugs / next milestone) so it matches the code.

## Product vision and non-negotiables

Voice-first accountability coach that turns brain-dumps into small actionable work. Vocabulary: **Movie** = goal, **Clip** = small task, **Today's Focus** = ≤3 clips for today, **Progress** = completed clips / total.

- AI never silently creates, edits or deletes data. AI output is a *proposal*; only the user's Approve click calls `/api/proposals/apply`. Keep tool definitions narrow; validate every argument server-side.
- Progress is computed from clips. Never store a percentage.
- Secrets stay server-side. The browser gets only single-use, short-lived Gemini Live tokens. Never log connection strings or keys.
- No silent fallbacks: if Atlas or Gemini is unavailable, say so. No fake successful responses.
- Keep it simple: no TypeScript migration, no state library, no analytics/gamification, no custom timeline editor.
- Single shared-access-key gate (`ACCESS_KEY`), not user accounts. Keep data access in `backend/src/services.js` so an owner/auth filter can be added there later.
- Production must fail closed: missing `ACCESS_KEY` / `FRONTEND_ORIGIN` / `MONGODB_URI` => API answers 503 (or `start.js` exits). Never fall back to an open API in production.
- Frontend and backend are separate deployable projects. The frontend must not depend on the backend's filesystem or env; its only link is `VITE_API_URL` (public).

## Architecture (as implemented)

Fresh scaffold (the original brief assumed an existing repo; none existed). Monorepo with two independent projects, each with its own `package.json` / lockfile / ESLint config; the root `package.json` only has helper scripts (`setup`, `dev`, `lint`, `test`, `build`) and `concurrently`. ESM, JavaScript.

```
backend/                     Express API; Vercel Root Directory = backend
  index.js                   Vercel entry: default-exports createApp({ensureDb, configProblems})
  src/start.js               long-running entry (local / always-on hosts): validate config → connect DB → listen
  src/createApp.js           express app: trust proxy, CORS allow-list, headers, json 100kb,
                             /api → configGate → accessGate → dbGate → routes, 404, error handler
  src/config.js              env parsing (backend/.env, then repo-root .env fallback); missingRequiredConfig()
  src/routes.js              ALL routes (movies, clips, focus, proposals, voice session, health)
  src/services.js            data-access layer (only place that touches models)
  src/coach.js               coach instructions, the single `propose_plan` tool, buildLiveConfig()
  src/lib/db.js              connectDb / ensureDb (serverless-safe, shared in-flight attempt) / dbStatus / redact
  src/lib/gates.js           configGate, accessGate (Bearer ACCESS_KEY, constant-time compare, lockout), dbGate
  src/lib/rateLimit.js       in-memory fixed-window limiter (per instance, best-effort)
  src/lib/errors.js          HttpError, parseId (ObjectId check), centralized errorHandler
  src/lib/schemas.js         Zod contracts (strict objects; reused by proposals)
  src/models/                Movie, Clip, Focus (toJSON → `id`, date-only strings)
  test/api.test.js, test/deploy.test.js   DB-free tests (node:test)
  scripts/smoke.mjs          live API smoke test (needs running server + real DB; honours ACCESS_KEY env)
frontend/                    React SPA; Vercel Root Directory = frontend
  vercel.json                SPA rewrite + security headers
  src/App.jsx, main.jsx, index.css   (Tailwind v4 @theme tokens + .btn/.card/.input)
  src/hooks/useWorkspace.js    persisted state; `mutate` → save → refetch; optimistic clip status; authError on 401
  src/hooks/useVoiceSession.js Gemini Live transport only (WebSocket, mic worklet, PCM playback; no dashboard knowledge)
  public/pcm-capture-worklet.js  AudioWorklet: mic → 16 kHz PCM16 chunks
  src/components/            MovieSidebar, MovieDetail, ClipRow, ClipForm, MovieForm, TodaysFocus,
                             VoiceCoach (owns pending proposals), ProposalCard, AccessGate, ui.jsx
  src/lib/api.js (fetch client: VITE_API_URL base, Bearer key, ApiError, health tolerates 503),
  src/lib/auth.js (access key in localStorage, memory fallback), src/lib/contracts.js
```

Versions at scaffold time: React 19.3, Vite 8.3, Tailwind 4.3, Express 5.3, Mongoose 9.11, Zod 4.6, @google/genai 3.2, Node 22 (`engines` 22.x). Add dependencies only for a concrete need.

## Data models and contracts

- **Movie**: `title` (req, ≤140), `description`, `status` active|completed|archived, `targetDate` (date or null), timestamps. JSON: `targetDate` as `YYYY-MM-DD`; list/detail add `progress {total, completed, percent}`; detail adds `clips[]` sorted by `order`.
- **Clip**: `movieId` (ref, indexed), `title`, `description`, `status` todo|in_progress|completed, `priority` low|medium|high (default medium), `dueDate`, `order` (next = max+1 per movie), timestamps. No reordering API yet.
- **Focus**: `{date: "YYYY-MM-DD" (unique, client's local day), clipIds[≤3]}`. Server validates existence and uniqueness; deleting a clip/movie pulls ids from all Focus docs.
- **Proposal**: `{movie:{title, description?, targetDate?}, clips:[{title, description?, priority?, dueDate?}]}` with 1–15 clips; strict (unknown keys rejected).
- Routes: see README "API overview". Updates use PATCH with strict schemas that reject unknown fields (so `movieId` cannot be changed).

## Environment variables

Backend (`backend/.env.example`): `MONGODB_URI` (required), `ACCESS_KEY` (required in production, ≥16 chars), `FRONTEND_ORIGIN` (comma-separated origins; required in production), `GEMINI_API_KEY`, `PORT` (3001, local only), `GEMINI_LIVE_MODEL`, `GEMINI_VOICE`, `GEMINI_API_VERSION` (v1alpha), `TRUST_PROXY` (1).
Frontend (`frontend/.env.example`, all public): `VITE_API_URL` (required in production builds), `DEV_API_TARGET`. Never put secrets in `VITE_*`.

## Commands

Root: `npm run setup` · `npm run dev` (both) · `npm run lint` (both) · `npm test` (backend, DB-free) · `npm run build` (frontend).
Backend (`cd backend`): `npm run dev|start|test|lint|smoke`. Frontend (`cd frontend`): `npm run dev|build|preview|lint`.
Frontend production builds need `VITE_API_URL`, otherwise the app shows "This build has no backend address" (deliberate).

## Verification status (be honest; update when you verify more)

Production diagnostics now emit structured JSON request logs with a response `X-Request-Id`, plus startup, config, database connection and health-check events. Logging excludes query strings, bodies and auth headers, and sanitizes configured secrets and MongoDB URI credentials. `config.js` skips loading local dotenv files under `NODE_ENV=test`, keeping DB-free tests isolated from developer `.env` values.

Verified in the build sessions: lint clean in both projects; frontend build OK; backend `npm test` 23/23 pass (validation, error shapes, health, redaction, token request shape with Google's HTTP endpoint stubbed, access key + lockout, production fail-closed, CORS incl. multiple origins and preflight, serverless DB gate returning 503 with CORS headers, rate limits, safe request/database logging, Vercel entrypoint health route); `backend/index.js` imported as a default-export handler and served over HTTP (fails closed in an unconfigured production env); `start.js` exits 1 with clear, credential-free messages for missing/malformed/unresolvable `MONGODB_URI` and for a production env without `ACCESS_KEY`/`FRONTEND_ORIGIN`; headless-Chromium checks: dashboard flows against a **mocked** `/api` (14), voice flow against a **mock** Gemini WebSocket with a fake mic (16), and the **real** Express app + built frontend on two origins (unlock screen, wrong/right key, DB-down message, Lock, no CORS errors) (8). These browser scripts were ad hoc and are not committed.

Current changes verified: `npm.cmd run lint`, `npm.cmd test` (23/23), `npm.cmd run build`, and `git diff --check` pass. The Vercel CLI build failure was caused by the root entrypoint not directly importing Express; it now imports/instantiates Express, and the API handler route is covered by a test. A real Vercel deployment still needs redeployment and verification.

**NOT verified (no Atlas/Gemini credentials, no MongoDB binary in the sandbox, no Vercel account):**
1. Any real DB behaviour: `services.js` (aggregation for progress, `$pull` from Focus, `applyProposal` rollback, `findOneAndUpdate` upsert), successful Atlas connection, `ensureDb` reconnect behaviour on a frozen/thawed serverless instance, `/health` returning 200. Run `npm run smoke` (in `backend/`).
2. `POST /api/voice/session` against Google (`ai.authTokens.create`). Open questions: (a) the SDK (@google/genai 3.2) says ephemeral tokens are **v1alpha only** while Google's docs page says v1beta; we default to `v1alpha` (`GEMINI_API_VERSION`); (b) the default model `gemini-3.8-live` comes from the docs at build time; (c) the `propose_plan` schema, system instruction and voice are locked into the token via `liveConnectConstraints` and also sent by the client; if Google rejects the connection for a config mismatch, compare `buildLiveConfig()` output with what the client sends.
3. The live Gemini session (`useVoiceSession.js`): message shapes in edge cases, `sendRealtimeInput({text})` as greeting and `[App note]` triggers, echo handling over speakers, session time limits and `goAway`, and whether the model reliably calls `propose_plan`.
4. **Vercel deployment itself.** The Vercel CLI initially failed to detect Express because `backend/index.js` only imported it indirectly; that entrypoint now imports and instantiates Express directly. Redeploy and confirm `/api/health` returns JSON rather than Vercel `404`. Frontend relies on Vite auto-detection plus `frontend/vercel.json`.
5. End-to-end approve flow with a real coach tool call.

## Known limitations / bugs to watch

- Access control is one shared key (localStorage in the browser), not accounts. Rate limit and lockout counters are in-memory per instance (weak on serverless).
- Atlas Network Access must allow Vercel's changing IPs (`0.0.0.0/0` with a strong password and a least-privilege DB user) unless fixed outbound IPs are used.
- Preview deployments need their origin in `FRONTEND_ORIGIN` and a matching `VITE_API_URL` to work.
- Voice transcript has no speech-start events from Gemini; the "listening" indicator is inferred from input transcription.
- Bundle is ~640 kB because `@google/genai` ships to the browser; code-split if it matters.
- Playback relies on the browser's echo cancellation; headphones recommended.
- No transactions: `applyProposal` rolls back manually on clip insert failure; a crash mid-way could leave a movie without clips.
- Focus docs accumulate one per day (no cleanup).
- Optimistic UI only for clip status; other mutations wait for the server.
- Date-only fields are stored as UTC midnight; Focus date comes from the client's local day.
- Express 5 / Mongoose 9 / Vite 8 are recent majors; only compiled and started here.
- `window.confirm` is used for deletes.

## Next recommended milestone

**Verify against real services, then deploy.**
1. Create `backend/.env` with Atlas + Gemini; run `npm run dev`, then `npm run smoke` in `backend/`; fix any failures.
2. Open the app, press Start talking, and walk through a real brain-dump → proposal → approve. Fix message-shape or session-config mismatches in `useVoiceSession.js` / `coach.js` / `routes.js` (items 2–3 above). Add a test for whatever breaks.
3. Deploy both projects following the README's Vercel guide; confirm `/api/health`, the unlock screen, CORS and voice over HTTPS. Record what differed from the guide here.
4. Then, in order: clip reordering, coach read-only awareness improvements, real user accounts (owner filter in `services.js`, gate `/api/voice/session`), a CI workflow running lint/test/build.
