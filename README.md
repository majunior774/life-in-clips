# Life in Clips

A voice-first productivity app that turns overwhelming goals into small, doable tasks through an AI accountability coach.

The repo holds **two independent projects**, deployable separately (for example as two Vercel projects):

| Folder | What it is |
| --- | --- |
| `frontend/` | React + Vite + Tailwind single-page app |
| `backend/` | Express API (MongoDB Atlas, Gemini token minting). Runs locally as a normal server, or on Vercel as one serverless function |

> **Access control:** the API is protected by a single shared **access key** (`ACCESS_KEY`). That is a single-user gate, not user accounts. There is no multi-user support. See [Security](#security-considerations).

## Core terms

| Term | Meaning |
| --- | --- |
| **Movie** | A major goal or project. |
| **Clip** | A small, actionable task inside a movie. |
| **Today's Focus** | Up to 3 clips you choose for today. |
| **Progress** | Share of a movie's clips that are completed, always computed from the actual clips. |
| **AI Coach** | A voice assistant that asks questions, spots competing priorities and *proposes* movies and clips. Nothing is saved until you approve it. |

## Features

- Dashboard with movies, clips (create / edit / delete / complete), progress strip, "Up next" highlight, empty / loading / saving / error states.
- Today's Focus (max 3 clips, validated against existing clips).
- Persistence in MongoDB Atlas via Mongoose, with server-side validation.
- Live voice coach using the Gemini Live API (streamed audio over a WebSocket), with transcript and interruption support.
- Approval gate: the coach can only *propose* a plan; you review it and press **Approve & save** (or Reject).
- Access-key gate, CORS allow-list, best-effort rate limits, and a health endpoint that reports server and database state separately.

Not included (by design): user accounts, teams, calendar sync, notifications, streaks, analytics, background agents.

## What has and has not been tested

Be aware of this before relying on the app. Details are in [AGENTS.md](AGENTS.md).

| Area | Status |
| --- | --- |
| Lint (both projects), frontend production build | Passed |
| Backend tests, no database needed (`npm test`, 20 tests): validation, error shapes, access key and lockout, production fail-closed config, CORS, DB-down handling, rate limits, token request shape | Passed |
| Vercel entry file (`backend/index.js`) loads and answers HTTP requests as a handler | Passed (locally) |
| Real Express backend + built frontend on two different origins: unlock screen, wrong/right key, DB-down message, no CORS errors | Passed (headless browser) |
| Dashboard and voice flows in a headless browser against a **mocked** API / **mock** Gemini WebSocket | Passed |
| CRUD, focus and proposal persistence against **real MongoDB** | **Not yet run** (use `npm run smoke` in `backend/`) |
| A real **Gemini token request and live voice session** | **Not yet run** |
| An actual **Vercel deployment** | **Not yet done** |

## Tech stack

React 19 + Vite 8 + Tailwind CSS 4 (JavaScript) · Node 22 + Express 5 · MongoDB Atlas + Mongoose 9 · Zod 4 · Gemini Live API (`@google/genai`).

## Architecture and data flow

```
Browser (frontend/) ──HTTPS──► Backend (backend/) ──► MongoDB Atlas
   │   Authorization: Bearer <ACCESS_KEY>
   │
   │  1. POST /api/voice/session ──► Gemini authTokens.create
   │     (backend holds GEMINI_API_KEY; returns a single-use, short-lived token,
   │      with the coach instructions and tool locked into it)
   │
   └─ 2. WebSocket (16 kHz PCM mic audio up, 24 kHz PCM coach audio down, transcripts,
         tool calls) directly to Gemini using only that token
```

Proposal flow: coach calls the `propose_plan` tool → browser sends args to `POST /api/proposals/validate` → proposal appears on screen → you approve → `POST /api/proposals/apply` re-validates and saves → dashboard refreshes. The coach has no tool that writes data.

Data model: `Clip.movieId` references its `Movie`; clips carry an `order`. Movies store no clip list and no percentage, so progress cannot drift. Today's Focus is one document per local date (`YYYY-MM-DD`) holding up to 3 clip ids.

## Prerequisites

- Node.js 22.12+ (or 20.19+) and npm
- A MongoDB Atlas account (free M0 cluster is enough)
- A Gemini API key (only needed for voice)
- A browser with microphone support. The microphone requires `localhost` or HTTPS.

## Local development

```bash
npm run setup                          # installs root, backend/ and frontend/
cp backend/.env.example backend/.env   # then edit backend/.env
npm run dev                            # API on :3001, web app on http://localhost:5173
```

`ACCESS_KEY` may stay empty locally (the API is then open to your machine). If you set it, the app shows an unlock screen and asks for it once. `frontend/.env` is optional locally (defaults work).

### MongoDB Atlas

1. Create a free cluster at <https://cloud.mongodb.com>.
2. **Database Access** → Add Database User → username + password (avoid special characters or URL-encode them). Give it read/write on your one database only, not "Atlas admin".
3. **Network Access** → Add IP Address → **Add Current IP Address** for local development.
4. **Database** → your cluster → **Connect** → **Drivers** → copy the `mongodb+srv://…` string.
5. Put it in `backend/.env` as `MONGODB_URI`, replacing `<password>` and adding a database name before the `?` (for example `/life-in-clips`).

The server refuses to start, with a clear message, if the URI is missing, malformed or unreachable. It never falls back to other storage.

### Gemini (voice)

1. Create a key at <https://aistudio.google.com/apikey>.
2. Set `GEMINI_API_KEY` in `backend/.env` and restart the backend.
3. Without a key the dashboard works fully and the coach panel says voice is unavailable.
4. Use headphones: the coach's audio can otherwise be picked up by your microphone and interrupt it.

## Deploying to production (two Vercel projects)

The steps below follow Vercel's documented Express and Vite support, but **this has not been deployed yet**. Follow them in order; the two apps need each other's address, so one redeploy is expected.

### 0. Put the code on GitHub

```bash
git init
git add .
git status        # confirm NO .env files are listed (only .env.example)
git commit -m "Initial commit"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

If a real key or password is ever committed, rotate it immediately (new Atlas password, new Gemini key): deleting the commit later does not remove it from history.

### 1. Allow Vercel to reach Atlas

Vercel functions do not run from one fixed IP, so a single allowed IP will not work. In Atlas → **Network Access** add `0.0.0.0/0` ("allow from anywhere"). This is acceptable only because the database user has a strong password and access to one database. (Vercel may offer fixed outbound IPs on paid plans; if you use that, allow only those instead.)

### 2. Create the backend project

1. Vercel → **Add New → Project** → import the GitHub repo.
2. Set **Root Directory** to `backend`. Vercel detects the Express app from `backend/index.js` (no build command needed).
3. Add **Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `MONGODB_URI` | your Atlas connection string |
   | `GEMINI_API_KEY` | your Gemini key |
   | `ACCESS_KEY` | a long random secret, at least 16 characters (generate: `node -p "require('crypto').randomBytes(24).toString('base64url')"`) |
   | `FRONTEND_ORIGIN` | your frontend URL (you can set a placeholder now and fix it in step 4) |

4. Deploy, then open `https://<backend>.vercel.app/api/health`. You should see JSON with `"server":{"status":"ok"}` and `"database":{"reachable":true}`.

If anything required is missing in production, the API answers `503` with a message naming the missing variable instead of running unprotected.

### 3. Create the frontend project

1. Vercel → **Add New → Project** → import the **same** repo again.
2. Set **Root Directory** to `frontend` (Vercel detects Vite).
3. Add the environment variable `VITE_API_URL` = your backend URL, for example `https://<backend>.vercel.app` (no trailing slash). It is baked in at build time, so changing it needs a redeploy. It is public: never put secrets in `VITE_*` variables.
4. Deploy.

### 4. Connect them

1. In the **backend** project set `FRONTEND_ORIGIN` to the frontend's exact URL, for example `https://<frontend>.vercel.app` (no trailing slash; several origins can be comma-separated, for example a custom domain too). Redeploy the backend, since environment variable changes apply to new deployments.
2. Open the frontend URL, enter your `ACCESS_KEY` on the unlock screen, and create a movie.
3. Try the voice coach (HTTPS is provided by Vercel, which the microphone needs).

Notes:
- Preview deployments get their own URLs; CORS only allows the origins listed in `FRONTEND_ORIGIN`, and `VITE_API_URL` is fixed per build. Treat the production URLs as the real app. (Vercel may also put its own deployment protection in front of preview URLs.)
- Any always-on Node host (Render, Railway, a VPS) can run the backend with `npm start` in `backend/` instead; the same environment variables apply.

## Environment variables

**Backend** (`backend/.env` locally, Vercel project settings in production)

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | yes | Atlas connection string |
| `ACCESS_KEY` | production | Shared secret for the whole API (≥16 chars). Optional locally |
| `FRONTEND_ORIGIN` | production | Allowed browser origin(s), comma-separated. Default `http://localhost:5173` |
| `GEMINI_API_KEY` | for voice | Mints single-use Live API tokens |
| `PORT` | no (3001) | Local server port (ignored on Vercel) |
| `GEMINI_LIVE_MODEL` | no | Live model name (default in `backend/src/config.js`) |
| `GEMINI_VOICE` | no | Coach voice (default `Kore`) |
| `GEMINI_API_VERSION` | no (`v1alpha`) | API version for ephemeral tokens and the browser connection |
| `TRUST_PROXY` | no (1) | Number of proxies in front of the app (Vercel = 1) |

**Frontend** (`frontend/.env` locally, Vercel project settings in production; all public)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | production | Backend address, no trailing slash |
| `DEV_API_TARGET` | no | Dev-server proxy target (default `http://localhost:3001`) |

## Commands

| Where | Command | What it does |
| --- | --- | --- |
| root | `npm run setup` | Install root, backend and frontend dependencies |
| root | `npm run dev` | Backend (watch mode) and frontend together |
| root | `npm run lint` / `npm test` / `npm run build` | Lint both / backend tests / frontend build |
| `backend/` | `npm run dev` / `npm start` | Backend with / without watch mode |
| `backend/` | `npm run smoke` | End-to-end API check against a **running** server and real database (creates and deletes `[smoke]` data; use a dev database; set `ACCESS_KEY` in the environment if the server has one) |
| `frontend/` | `npm run dev` / `build` / `preview` | Vite dev server / production build / serve the build |

## API overview

All routes are under `/api`; errors look like `{ "error": { "message", "details?" } }`. Every route except `GET /health` needs `Authorization: Bearer <ACCESS_KEY>` when an access key is configured.

| Method & path | Purpose |
| --- | --- |
| `GET /health` | `server`, `database`, `voice.configured`, `auth.required` (503 if the DB is unreachable) |
| `GET /movies`, `POST /movies` | List (with progress) / create |
| `GET /movies/:id`, `PATCH`, `DELETE` | Read with clips / update / delete (cascades its clips) |
| `POST /movies/:id/clips` | Create clip |
| `PATCH /clips/:id`, `DELETE /clips/:id` | Update / delete clip |
| `GET /focus?date=YYYY-MM-DD`, `PUT /focus` | Read / set Today's Focus (`{date, clipIds}`, max 3) |
| `POST /proposals/validate` | Dry-run validation of an AI proposal (saves nothing) |
| `POST /proposals/apply` | Validate and save an approved proposal |
| `POST /voice/session` | Mint a single-use Gemini Live token plus the locked session config (rate limited) |

## Current limitations

- One shared access key, no user accounts; no clip drag-and-drop reordering (order is assigned at creation).
- Rate limits and lockout counters are per server instance. On Vercel each warm instance has its own, so they slow down guessing and loops but are not a global hard limit.
- Today's Focus is per calendar date; no reminders or scheduling.
- The coach can create new movies with clips; it cannot edit or delete existing data (by design for now).
- Voice, persistence and Vercel deployment are implemented but not yet verified end-to-end (see the table above).
- The default Live model name and API version come from Google's docs and SDK; set `GEMINI_LIVE_MODEL` / `GEMINI_API_VERSION` if your account needs different ones. Gemini Live audio sessions have a time limit; press Reconnect if a long one ends.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Local backend exits with "MONGODB_URI is not set" | Create `backend/.env` from `backend/.env.example` |
| "authentication failed" | Wrong Atlas user/password; URL-encode special characters |
| "server selection timed out" | The machine's IP (or Vercel, see step 1) is not in Atlas Network Access |
| "host could not be resolved" | Typo in the cluster hostname, or no internet |
| Header shows "Database offline" | Backend is up but cannot reach Atlas: check `MONGODB_URI` and Network Access |
| Header shows "API offline" / "Cannot reach the backend at …" | Backend down, wrong `VITE_API_URL`, or `FRONTEND_ORIGIN` does not include this site's exact address (CORS) |
| "This build has no backend address" | `VITE_API_URL` was not set when the frontend was built; set it and redeploy |
| Unlock screen keeps rejecting the key | It must equal the backend's `ACCESS_KEY`; after 10 wrong tries the client is locked out for 15 minutes |
| API returns 503 "Server is misconfigured" | A required production variable is missing; the message names it |
| Voice: "GEMINI_API_KEY is not configured" | Set the key on the backend and redeploy/restart |
| Voice: "Gemini rejected the voice session request" | Check `GEMINI_LIVE_MODEL` and `GEMINI_API_VERSION` |
| Voice: "Gemini rejected GEMINI_API_KEY" | Key invalid or restricted; create a new one in Google AI Studio |
| Voice: microphone blocked | Allow the mic for this site in browser settings; use `localhost` or HTTPS |

## Security considerations

- **Access key, not accounts.** Anyone with the key has full access to the data and can start voice sessions that spend your Gemini quota. Use a long random key, keep it private, and rotate it by changing `ACCESS_KEY` and redeploying. It is stored in the browser's local storage; use the **Lock** button on shared computers.
- The backend refuses to run unprotected in production: without a valid `ACCESS_KEY` and `FRONTEND_ORIGIN` it answers 503.
- Secrets stay on the backend. The browser only receives a single-use, short-lived Live token. Error messages and logs redact connection strings and never include API keys. The frontend bundle contains no secrets (only the public `VITE_API_URL`).
- CORS allows only the configured origins. Wrong-key attempts are limited, and `/voice/session` is rate limited (best-effort, see limitations).
- Microphone audio goes directly from the browser to Google (Gemini). A short summary of your active movies and open clip titles is sent to Google as part of the coach's instructions so it avoids duplicates.
- AI proposals are validated on the server with strict schemas (unknown fields rejected, size limits) and are saved only after you approve them.
- Use a database user limited to one database, and a Gemini key used only by this backend.
