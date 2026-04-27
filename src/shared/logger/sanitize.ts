/**
 * Strip personally-identifying information out of log payloads. We sanitize
 * at the *logger* level (one chokepoint) rather than at every call site, so
 * a forgotten `logger.info('user', user)` cannot leak PII.
 *
 * Rules:
 *   - Drop any property whose key matches a sensitive name (case-insensitive
 *     contains-match against a small denylist).
 *   - Recurse into plain objects and arrays.
 *   - Truncate strings longer than `maxStringLength`.
 *   - Leave primitives (numbers, booleans, null, undefined) alone.
 *
 * The denylist is intentionally narrow — overly aggressive sanitization
 * makes logs useless. Add to the list as new fields appear.
 */

const SENSITIVE_KEYS = [
  'email',
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'apikey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'phone',
  'phonenumber',
  'address',
  'firstname',
  'lastname',
  'fullname',
  'displayname',
  'avatar',
  'avatarurl',
  'paymentmethodid',
  'cardnumber',
  'cvc',
  'cvv',
  'ssn',
  'taxid',
  'pushtoken',
];

const REDACTED = '[REDACTED]';

const DEFAULT_MAX_STRING = 500;

const isSensitiveKey = (key: string): boolean => {
  const lc = key.toLowerCase();
  return SENSITIVE_KEYS.some((needle) => lc.includes(needle));
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  Object.getPrototypeOf(v) === Object.prototype;

export function sanitizeForLogging(
  value: unknown,
  options: { maxStringLength?: number; maxDepth?: number } = {},
): unknown {
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING;
  const maxDepth = options.maxDepth ?? 6;
  return walk(value, maxDepth, maxStringLength);
}

function walk(value: unknown, depth: number, maxStringLength: number): unknown {
  if (depth < 0) return '[truncated:depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}…[truncated]`
      : value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth - 1, maxStringLength));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k)
        ? REDACTED
        : walk(v, depth - 1, maxStringLength);
    }
    return out;
  }
  // Class instances, functions, symbols: stringify defensively.
  return `[unloggable:${typeof value}]`;
}
