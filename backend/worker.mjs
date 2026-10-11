/** Optional Cloudflare Worker. No runtime packages; never serve this file as the site. */
const MAX_BODY_BYTES = 8192;
const MAX_EXPORT_ROWS = 10000;
const MIN_FORM_AGE_MS = 1000;
const MAX_FORM_AGE_MS = 48 * 60 * 60 * 1000;
const TURNSTILE_ACTION = 'winter-camp-interest';
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CONSENT_VERSION = 'winter-camp-interest-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ALLOWED_FIELDS = new Set([
  'parentName', 'email', 'phone', 'interest', 'consent', 'website', 'startedAt',
  'turnstileToken', 'submissionId',
]);
const encoder = new TextEncoder();

export const INSERT_INTEREST = `
  INSERT INTO parent_interest (
    id, submission_id, request_fingerprint, received_at, parent_name,
    email, phone, interest, consent_at, consent_version
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  ON CONFLICT(submission_id) DO UPDATE SET submission_id = excluded.submission_id
  WHERE parent_interest.request_fingerprint = excluded.request_fingerprint
  RETURNING 1 AS accepted
`;

const EXPORT_INTEREST = `
  SELECT id, received_at, parent_name, email, phone, interest, consent_at, consent_version
  FROM parent_interest ORDER BY received_at ASC, id ASC LIMIT ?1
`;

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function response(status, code, origin, extra = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
    ...extra,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(code ? { ok: false, error: code } : { ok: true }), { status, headers });
}

function configuredOrigin(env) {
  try {
    const url = new URL(env.ALLOWED_ORIGIN);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== env.ALLOWED_ORIGIN || url.username || url.password ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) return null;
    return url.origin;
  } catch { return null; }
}

function configuredSecret(value, minimum, maximum = 256) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum &&
    !value.startsWith('REPLACE_') && !CONTROL_CHARACTERS.test(value);
}

function requireConfiguration(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function' ||
      !env.INTEREST_RATE_LIMITER || typeof env.INTEREST_RATE_LIMITER.limit !== 'function' ||
      !configuredSecret(env.RATE_LIMIT_SALT, 32) ||
      !configuredSecret(env.TURNSTILE_SECRET, 10) ||
      !configuredOrigin(env)) {
    throw new RequestError(503, 'service_unavailable');
  }
}

async function readBoundedJSON(request) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(413, 'request_too_large');
  }
  if (!request.body) throw new RequestError(400, 'invalid_request');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, 'request_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RequestError(400, 'invalid_request'); }
}

function validEmail(email) {
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(email)) return false;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function validate(body, now) {
  const reject = () => { throw new RequestError(400, 'validation_failed'); };
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
      Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) reject();
  if (typeof body.parentName !== 'string' || body.parentName.length > 120 ||
      !body.parentName.trim() || CONTROL_CHARACTERS.test(body.parentName)) reject();
  if (typeof body.email !== 'string' || body.email.length > 254 || !validEmail(body.email.trim())) reject();
  if (body.phone !== undefined && (typeof body.phone !== 'string' || body.phone.length > 32 ||
      CONTROL_CHARACTERS.test(body.phone) || !/^[+\d().\- ]*$/.test(body.phone))) reject();
  if (!['interested', 'questions'].includes(body.interest) || body.consent !== true || body.website !== '') reject();
  if (!Number.isSafeInteger(body.startedAt) || body.startedAt <= 0 ||
      now - body.startedAt < MIN_FORM_AGE_MS || now - body.startedAt > MAX_FORM_AGE_MS) reject();
  if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length < 1 ||
      body.turnstileToken.length > 2048 || CONTROL_CHARACTERS.test(body.turnstileToken)) reject();
  if (typeof body.submissionId !== 'string' || !UUID.test(body.submissionId)) reject();
  return {
    parentName: body.parentName.trim(), email: body.email.trim(), phone: body.phone?.trim() || '',
    interest: body.interest, consent: true, submissionId: body.submissionId.toLowerCase(),
    turnstileToken: body.turnstileToken,
  };
}

async function hmac(crypto, key, value) {
  const imported = await crypto.subtle.importKey('raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', imported, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(request, env, crypto, category) {
  // Only trust the edge-supplied header in the intended Cloudflare runtime, not X-Forwarded-For.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64) throw new RequestError(503, 'service_unavailable');
  const key = await hmac(crypto, env.RATE_LIMIT_SALT, `${category}:${ip}`);
  let result;
  try { result = await env.INTEREST_RATE_LIMITER.limit({ key }); }
  catch { throw new RequestError(503, 'service_unavailable'); }
  if (result?.success !== true) throw new RequestError(429, 'rate_limited');
}

async function verifyTurnstile(data, env, origin, { fetch, crypto }) {
  // Token-verification idempotency is separate from the persistent form submission ID.
  // A new token on a retry gets a new verification request. No form PII is sent to Siteverify.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(TURNSTILE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: data.turnstileToken,
        idempotency_key: crypto.randomUUID() }), signal: controller.signal,
    });
    if (!res.ok) throw new RequestError(503, 'verification_unavailable');
    const verification = await res.json();
    if (verification.success !== true || verification.hostname !== new URL(origin).hostname ||
        verification.action !== TURNSTILE_ACTION) {
      throw new RequestError(400, 'verification_failed');
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(503, 'verification_unavailable');
  } finally { clearTimeout(timer); }
}

async function saveInterest(data, env, now, crypto) {
  const canonical = JSON.stringify([data.parentName, data.email, data.phone, data.interest, CONSENT_VERSION]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const timestamp = new Date(now).toISOString();
  let accepted;
  try {
    // One atomic statement: no race between checking an ID and saving the record.
    // Identical retries do not overwrite the original record or consent timestamp.
    accepted = await env.DB.prepare(INSERT_INTEREST).bind(
      crypto.randomUUID(), data.submissionId, fingerprint, timestamp, data.parentName,
      data.email, data.phone, data.interest, timestamp, CONSENT_VERSION,
    ).first('accepted');
  } catch { throw new RequestError(503, 'storage_unavailable'); }
  if (accepted !== 1) throw new RequestError(409, 'submission_conflict');
}

async function isAdmin(request, token, crypto) {
  const authorization = request.headers.get('Authorization') || '';
  if (!configuredSecret(token, 32) ||
      !authorization.startsWith('Bearer ') || authorization.length > 263) return false;
  // The constant-time signature verification is provided by Web Crypto.
  const key = await crypto.subtle.importKey('raw', encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(authorization.slice(7)));
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheet formulas. Preserve safe text cells on export.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportInterest(env) {
  let results;
  try {
    const query = await env.DB.prepare(EXPORT_INTEREST).bind(MAX_EXPORT_ROWS + 1).all();
    if (query.success === false || !Array.isArray(query.results)) throw new Error('Invalid storage result');
    results = query.results;
  } catch { throw new RequestError(503, 'storage_unavailable'); }
  // Refuse rather than silently give an incomplete export.
  if (results.length > MAX_EXPORT_ROWS) throw new RequestError(413, 'export_too_large');
  const columns = ['id', 'received_at', 'parent_name', 'email', 'phone', 'interest', 'consent_at', 'consent_version'];
  const csv = [columns, ...results.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="winter-camp-parent-interest.csv"',
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Vary': 'Origin',
    },
  });
}

/** Dependency injection is for offline tests. Production uses the exported default below. */
export function createWorker(dependencies = {}) {
  const runtime = {
    fetch: dependencies.fetch || globalThis.fetch.bind(globalThis),
    crypto: dependencies.crypto || globalThis.crypto,
    now: dependencies.now || Date.now,
  };
  return {
    async fetch(request, env = {}) {
      let corsOrigin;
      try {
        const url = new URL(request.url);
        if (url.pathname !== '/interest' && url.pathname !== '/admin/export') return response(404, 'not_found');
        if (url.search) return response(400, 'invalid_request');
        const origin = configuredOrigin(env);
        const requestOrigin = request.headers.get('Origin');
        if (url.pathname === '/admin/export') {
          // No admin CORS and no cookie auth. A token must never appear in a query string.
          if (requestOrigin) return response(403, 'forbidden');
          if (request.method !== 'GET') return response(405, 'method_not_allowed', null, { Allow: 'GET' });
          requireConfiguration(env);
          await rateLimit(request, env, runtime.crypto, 'admin');
          if (!(await isAdmin(request, env.ADMIN_TOKEN, runtime.crypto))) return response(401, 'unauthorized');
          return await exportInterest(env);
        }
        if (!origin) return response(503, 'service_unavailable');
        if (requestOrigin !== origin) return response(403, 'forbidden');
        corsOrigin = origin;
        if (request.method === 'OPTIONS') {
          const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '')
            .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
          if (request.headers.get('Access-Control-Request-Method') !== 'POST' ||
              requestedHeaders.some((header) => header !== 'content-type')) return response(403, 'forbidden', origin);
          return new Response(null, { status: 204, headers: {
            'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
            'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
            'Cache-Control': 'no-store',
          } });
        }
        if (request.method !== 'POST') return response(405, 'method_not_allowed', origin, { Allow: 'POST, OPTIONS' });
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '') ||
            (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity')) {
          return response(415, 'unsupported_media_type', origin);
        }
        requireConfiguration(env);
        await rateLimit(request, env, runtime.crypto, 'interest');
        const data = validate(await readBoundedJSON(request), runtime.now());
        await verifyTurnstile(data, env, origin, runtime);
        await saveInterest(data, env, runtime.now(), runtime.crypto);
        return response(200, null, origin);
      } catch (error) {
        if (error instanceof RequestError) return response(error.status, error.code, corsOrigin,
          error.status === 429 ? { 'Retry-After': '60' } : {});
        // Do not log request bodies, IPs, tokens, database errors, or any personal data.
        return response(503, 'service_unavailable', corsOrigin);
      }
    },
  };
}

export default createWorker();
