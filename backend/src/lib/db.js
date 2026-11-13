import mongoose from 'mongoose';
import { config } from '../config.js';

const STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

/** Strips credentials from anything that might contain the connection string. */
export function redact(text) {
  return String(text ?? '')
    .replaceAll(config.mongodbUri, '[MONGODB_URI]')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[credentials]@');
}

/** Connects to MongoDB. Throws a clear, redacted error on failure. No silent fallback. */
export async function connectDb(uri = config.mongodbUri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
  } catch (err) {
    const hint = classify(err);
    const error = new Error(`Could not connect to MongoDB: ${hint}`);
    error.cause = redact(err.message);
    throw error;
  }
  return mongoose.connection;
}

function classify(err) {
  const msg = String(err?.message || '');
  if (/auth/i.test(msg)) return 'authentication failed. Check the database user and password in MONGODB_URI.';
  if (/ENOTFOUND|querySrv|getaddrinfo/i.test(msg))
    return 'host could not be resolved. Check the cluster hostname in MONGODB_URI and your internet connection.';
  if (/Server selection timed out|ECONNREFUSED|timed out/i.test(msg))
    return 'server selection timed out. Atlas Network Access probably does not allow this machine\'s IP address.';
  return redact(msg) || 'unknown error.';
}

let pending = null;

/**
 * Idempotent connect for serverless: reuses the live connection across warm invocations,
 * reconnects if it dropped, and shares one in-flight attempt between concurrent requests.
 */
export async function ensureDb() {
  if (mongoose.connection.readyState === 1) return;
  if (!pending) {
    pending = connectDb().finally(() => {
      pending = null;
    });
  }
  await pending;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/** Database connectivity snapshot used by the health endpoint. */
export async function dbStatus() {
  const state = STATES[mongoose.connection.readyState] ?? 'unknown';
  if (mongoose.connection.readyState !== 1) return { state, reachable: false };
  try {
    await mongoose.connection.db.admin().ping();
    return { state, reachable: true };
  } catch {
    return { state, reachable: false };
  }
}
