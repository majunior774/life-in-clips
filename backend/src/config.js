import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Local development only: backend/.env first, then a repo-root .env as a fallback.
// Neither overrides real environment variables (which is how hosts like Vercel provide them).
dotenv.config({ quiet: true });
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

/**
 * Central server configuration.
 * Secrets are read here once and never logged.
 */
export const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  get isProduction() {
    return this.nodeEnv === 'production';
  },
  // Comma-separated list of browser origins allowed by CORS, e.g. https://app.example.com
  frontendOrigins: list(process.env.FRONTEND_ORIGIN || 'http://localhost:5173'),
  frontendOriginExplicit: Boolean(process.env.FRONTEND_ORIGIN),
  // Number of reverse proxies in front of the app (Vercel = 1) so req.ip is the real client.
  trustProxy: Number(process.env.TRUST_PROXY ?? 1),
  // Shared secret protecting the whole API (single-user gate). Required in production.
  accessKey: process.env.ACCESS_KEY || '',
  mongodbUri: process.env.MONGODB_URI || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiLiveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
  geminiVoice: process.env.GEMINI_VOICE || 'Kore',
  // The SDK documents ephemeral-token support for v1alpha; Google's docs page mentions v1beta.
  // Kept as one value, sent to the browser too, so both sides always agree.
  geminiApiVersion: process.env.GEMINI_API_VERSION || 'v1alpha',
};

export const MIN_ACCESS_KEY_LENGTH = 16;

/** Returns human-readable problems that make the server unsafe or unable to run. */
export function missingRequiredConfig() {
  const problems = [];
  if (!config.mongodbUri) {
    problems.push(
      'MONGODB_URI is not set. Set it in backend/.env (local) or in your host\'s environment variables, using your MongoDB Atlas connection string (see README, "MongoDB Atlas setup").',
    );
  } else if (!/^mongodb(\+srv)?:\/\//.test(config.mongodbUri)) {
    problems.push('MONGODB_URI must start with "mongodb://" or "mongodb+srv://".');
  }
  if (config.isProduction) {
    if (config.accessKey.length < MIN_ACCESS_KEY_LENGTH) {
      problems.push(`ACCESS_KEY must be set to a secret of at least ${MIN_ACCESS_KEY_LENGTH} characters in production.`);
    }
    if (!config.frontendOriginExplicit) {
      problems.push('FRONTEND_ORIGIN must be set to your deployed frontend URL in production.');
    }
  }
  return problems;
}
