import { config } from '../config.js';

function sanitize(value) {
  if (typeof value === 'string') {
    let result = value;
    for (const secret of [config.mongodbUri, config.accessKey, config.geminiApiKey]) {
      if (secret) result = result.replaceAll(secret, '[REDACTED]');
    }
    return result
      .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[credentials]@')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:key|api_key|access_token|token)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
  }
  return value;
}

export function log(level, event, fields = {}) {
  console[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitize(fields),
    }),
  );
}
