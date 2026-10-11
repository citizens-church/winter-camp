import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import { createWorker, csvCell } from '../backend/worker.mjs';

// All contact details below are invented; fetch and the Cloudflare edge binding are mocked.
// SQLite exercises the real migration and SQL locally, without any network or deployed data.
const NOW = Date.parse('2026-10-11T04:00:00Z');
const ORIGIN = 'https://camp.example.test';
const SUBMISSION_ID = '8e565105-207f-4b75-a343-417bdc0adfb5';
const migration = readFileSync(new URL('../backend/migrations/0001_parent_interest.sql', import.meta.url), 'utf8');
const fixture = (changes = {}) => ({
  parentName: 'Synthetic Parent', email: 'parent@example.test', phone: '',
  interest: 'interested', consent: true, website: '', startedAt: NOW - 10000,
  turnstileToken: 'synthetic-token', submissionId: SUBMISSION_ID, ...changes,
});

function harness(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  const fetches = [];
  const rateKeys = [];
  const env = {
    ALLOWED_ORIGIN: ORIGIN,
    TURNSTILE_SECRET: 'synthetic-verification-secret',
    RATE_LIMIT_SALT: 'synthetic-rate-salt-for-local-tests-only',
    ADMIN_TOKEN: 'synthetic-admin-token-for-local-tests-only',
    INTEREST_RATE_LIMITER: { async limit({ key }) { rateKeys.push(key); return { success: true }; } },
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        return {
          bind(...values) {
            return {
              async first(column) { const row = statement.get(...values); return row ? (column ? row[column] : row) : null; },
              async all() { return { success: true, results: statement.all(...values) }; },
            };
          },
        };
      },
    },
    ...options.env,
  };
  const worker = createWorker({
    now: () => NOW,
    crypto: webcrypto,
    async fetch(url, init) {
      fetches.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      return Response.json({ success: true, hostname: 'camp.example.test', action: 'winter-camp-interest' });
    },
  });
  function request(data = fixture(), overrides = {}) {
    const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', ...overrides.headers };
    for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
    const method = overrides.method || 'POST';
    return new Request(`https://api.example.test${overrides.path || '/interest'}`, {
      method, headers, ...(method === 'POST' ? { body: overrides.raw ?? JSON.stringify(data) } : {}),
    });
  }
  const run = (data, overrides) => worker.fetch(request(data, overrides), env);
  const count = () => sqlite.prepare('SELECT COUNT(*) AS count FROM parent_interest').get().count;
  const rows = () => sqlite.prepare('SELECT * FROM parent_interest').all();
  const admin = (overrides = {}) => worker.fetch(request(undefined, {
    method: 'GET', path: '/admin/export', headers: { Origin: null, Authorization: `Bearer ${env.ADMIN_TOKEN}`, ...overrides.headers },
    ...overrides,
  }), env);
  return { sqlite, worker, env, fetches, rateKeys, request, run, count, rows, admin };
}

async function expectFailure(h, body, status = 400, overrides) {
  const res = await h.run(body, overrides);
  assert.equal(res.status, status);
  assert.equal((await res.json()).ok, false);
  assert.equal(h.count(), 0);
  return res;
}

test('saves validated adult contact data durably before returning only ok:true', async () => {
  const h = harness();
  const res = await h.run(fixture({ parentName: '  Synthetic Parent  ', phone: '+1 (202) 555-0100' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'no-store, private');
  const [row] = h.rows();
  assert.equal(row.parent_name, 'Synthetic Parent');
  assert.equal(row.phone, '+1 (202) 555-0100');
  assert.equal(row.email, 'parent@example.test');
  assert.notEqual(row.id, SUBMISSION_ID);
  assert.equal(row.submission_id, SUBMISSION_ID);
  assert.equal(row.consent_at, new Date(NOW).toISOString());
  assert.equal(row.consent_version, 'winter-camp-interest-v1');
  assert.equal(Object.hasOwn(row, 'turnstileToken'), false);
  assert.equal(Object.hasOwn(row, 'startedAt'), false);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const verification = JSON.parse(h.fetches[0].init.body);
  assert.deepEqual(Object.keys(verification).sort(), ['idempotency_key', 'response', 'secret']);
  assert.equal(h.fetches[0].init.redirect, 'error');
  assert.equal(h.rateKeys.length, 1);
  assert.match(h.rateKeys[0], /^[a-f0-9]{64}$/);
  assert.equal(h.rateKeys[0].includes('192.0.2.10'), false);
});

test('optional phone and questions intent are accepted', async () => {
  const h = harness(); const body = fixture({ interest: 'questions' }); delete body.phone;
  assert.equal((await h.run(body)).status, 200);
  assert.equal(h.rows()[0].phone, '');
  assert.equal(h.rows()[0].interest, 'questions');
});

test('identical retries store one row and preserve original ID', async () => {
  const h = harness();
  assert.equal((await h.run()).status, 200);
  const original = h.rows()[0];
  assert.equal((await h.run(fixture({ turnstileToken: 'fresh-synthetic-token', startedAt: NOW - 20000 }))).status, 200);
  assert.equal(h.count(), 1);
  assert.deepEqual(h.rows()[0], original);
});

test('same submission ID with altered data is rejected without leaking stored details', async () => {
  const h = harness(); await h.run();
  const res = await h.run(fixture({ email: 'changed@example.test' }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, error: 'submission_conflict' });
  assert.equal(h.count(), 1);
  assert.equal(h.rows()[0].email, 'parent@example.test');
});

test('database unavailability cannot report success', async () => {
  const h = harness({ env: { DB: { prepare() { throw new Error('synthetic-private-database-details'); } } } });
  const res = await expectFailure(h, fixture(), 503);
  assert.equal(res.headers.get('cache-control'), 'no-store, private');
});

test('response waits for the database acknowledgement', async () => {
  let release;
  const stored = new Promise((resolve) => { release = resolve; });
  const h = harness({ env: { DB: { prepare() { return { bind() { return { first: () => stored }; } }; } } } });
  let finished = false;
  const response = h.run().then((res) => { finished = true; return res; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(finished, false);
  release(1);
  assert.equal((await response).status, 200);
});

test('server rejects invalid fields before Turnstile or storage', async (t) => {
  const invalid = [
    ['null', null], ['array', []], ['unknown child field', fixture({ childName: 'Do not collect' })],
    ['free text', fixture({ message: 'Do not collect' })], ['name missing', fixture({ parentName: '' })],
    ['name type', fixture({ parentName: 10 })], ['name maximum', fixture({ parentName: 'x'.repeat(121) })],
    ['name newline', fixture({ parentName: 'Parent\nOther' })], ['email invalid', fixture({ email: 'not-an-email' })],
    ['email newline', fixture({ email: 'parent\n@example.test' })], ['email double dots', fixture({ email: 'a..b@example.test' })],
    ['email leading dot', fixture({ email: '.parent@example.test' })], ['email domain', fixture({ email: 'parent@-example.test' })],
    ['email multiple ats', fixture({ email: 'a@b@example.test' })], ['email length', fixture({ email: 'a'.repeat(255) + '@example.test' })],
    ['phone type', fixture({ phone: 0 })], ['phone max', fixture({ phone: '1'.repeat(33) })],
    ['phone letters', fixture({ phone: 'not-a-phone' })], ['invalid interest', fixture({ interest: 'enrolled' })],
    ['consent false', fixture({ consent: false })], ['consent string', fixture({ consent: 'true' })],
    ['honeypot nonempty', fixture({ website: 'robot.example' })], ['honeypot absent', fixture({ website: undefined })],
    ['startedAt absent', fixture({ startedAt: undefined })], ['startedAt future', fixture({ startedAt: NOW + 10000 })],
    ['startedAt too quick', fixture({ startedAt: NOW - 500 })], ['startedAt old', fixture({ startedAt: NOW - 49 * 3600000 })],
    ['startedAt string', fixture({ startedAt: String(NOW - 10000) })], ['startedAt fractional', fixture({ startedAt: NOW - 10000.5 })],
    ['token missing', fixture({ turnstileToken: '' })], ['token oversized', fixture({ turnstileToken: 'x'.repeat(2049) })],
    ['UUID invalid', fixture({ submissionId: 'not-a-uuid' })], ['UUID wrong version', fixture({ submissionId: '8e565105-207f-1b75-a343-417bdc0adfb5' })],
  ];
  for (const [name, body] of invalid) await t.test(name, async () => {
    const h = harness(); await expectFailure(h, body); assert.equal(h.fetches.length, 0);
  });
});

test('maximum name length and unicode are accepted; SQL parameters remain data', async () => {
  const h = harness();
  const name = "O'Parent ";
  assert.equal((await h.run(fixture({ parentName: name + 'é'.repeat(120 - name.length) }))).status, 200);
  assert.equal(h.rows()[0].parent_name.length, 120);
});

test('JSON parsing and streamed byte limit reject invalid or oversized bodies', async (t) => {
  for (const raw of ['{', 'null', '[]', '{"__proto__":{}}', 'x'.repeat(8193), 'é'.repeat(4100)]) {
    await t.test(`body ${raw.length} characters`, async () => {
      const h = harness(); const res = await h.run(undefined, { raw });
      assert.ok([400, 413].includes(res.status)); assert.equal(h.count(), 0); assert.equal(h.fetches.length, 0);
    });
  }
  const h = harness();
  await expectFailure(h, fixture(), 413, { headers: { 'Content-Length': '8193' } });
  await expectFailure(h, fixture(), 413, { raw: 'x'.repeat(8193), headers: { 'Content-Length': '100' } });
  await expectFailure(h, fixture(), 400, { raw: new Uint8Array([0xc0, 0x80]) });
});

test('only exact allowed origin can use the form', async (t) => {
  for (const origin of [null, 'null', '*', 'https://evil.example.test', ORIGIN + '.evil.test', ORIGIN + '/']) {
    await t.test(String(origin), async () => {
      const h = harness(); const res = await expectFailure(h, fixture(), 403, { headers: { Origin: origin } });
      assert.equal(res.headers.has('access-control-allow-origin'), false); assert.equal(h.fetches.length, 0);
    });
  }
});

test('preflight allows only POST Content-Type and exposes no credentials', async () => {
  const h = harness();
  const res = await h.run(undefined, { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type',
  } });
  assert.equal(res.status, 204); assert.equal(await res.text(), '');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.has('access-control-allow-credentials'), false);
  assert.equal(h.rateKeys.length, 0); assert.equal(h.fetches.length, 0);
  assert.equal((await h.run(undefined, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
  assert.equal((await h.run(undefined, { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization',
  } })).status, 403);
});

test('method, route, query string and content type constraints', async () => {
  const h = harness();
  assert.equal((await h.run(undefined, { method: 'GET' })).status, 405);
  assert.equal((await h.run(undefined, { path: '/unknown' })).status, 404);
  assert.equal((await h.run(undefined, { path: '/interest?email=private' })).status, 400);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', null]) {
    assert.equal((await h.run(undefined, { headers: { 'Content-Type': type } })).status, 415);
  }
  assert.equal((await h.run(undefined, { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal(h.count(), 0);
});

test('missing or invalid required configuration fails closed', async (t) => {
  for (const [key, value] of [
    ['DB', undefined], ['TURNSTILE_SECRET', ''], ['RATE_LIMIT_SALT', 'short'], ['INTEREST_RATE_LIMITER', undefined],
    ['TURNSTILE_SECRET', 'REPLACE_WITH_LOCAL_TURNSTILE_TEST_SECRET'],
    ['RATE_LIMIT_SALT', 'REPLACE_WITH_INDEPENDENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS'],
    ['ALLOWED_ORIGIN', '*'], ['ALLOWED_ORIGIN', ORIGIN + '/'], ['ALLOWED_ORIGIN', 'http://camp.example.test'],
  ]) await t.test(key + String(value), async () => {
    const h = harness({ env: { [key]: value } });
    await expectFailure(h, fixture(), 503); assert.equal(h.fetches.length, 0);
  });
});

test('rate limits and unavailable limiter do not fall back to acceptance', async () => {
  const limited = harness({ env: { INTEREST_RATE_LIMITER: { limit: async () => ({ success: false }) } } });
  const res = await expectFailure(limited, fixture(), 429);
  assert.equal(res.headers.get('retry-after'), '60'); assert.equal(limited.fetches.length, 0);
  const down = harness({ env: { INTEREST_RATE_LIMITER: { limit: async () => { throw new Error('offline'); } } } });
  await expectFailure(down, fixture(), 503); assert.equal(down.fetches.length, 0);
  const noIp = harness();
  await expectFailure(noIp, fixture(), 503, { headers: { 'CF-Connecting-IP': null, 'X-Forwarded-For': '192.0.2.10' } });
});

test('Turnstile rejects unsuccessful tokens, wrong hostname/action, and transport failures', async (t) => {
  const cases = [
    [400, () => Response.json({ success: false })],
    [400, () => Response.json({ success: true, hostname: 'wrong.example', action: 'winter-camp-interest' })],
    [400, () => Response.json({ success: true, hostname: 'camp.example.test', action: 'login' })],
    [400, () => Response.json({ success: true, hostname: 'camp.example.test' })],
    [503, () => new Response('offline', { status: 500 })],
    [503, () => new Response('not JSON')],
    [503, () => { throw new Error('network unavailable'); }],
  ];
  for (const [status, fetch] of cases) await t.test(String(status), async () => {
    const h = harness({ fetch }); await expectFailure(h, fixture(), status);
  });
});

test('admin export is authenticated, private, attachment-only and includes no token/digest', async () => {
  const h = harness(); await h.run(fixture({ parentName: '"Synthetic", Parent', phone: '+1 202 555 0100' }));
  const res = await h.admin();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  assert.equal(res.headers.get('cache-control'), 'no-store, private');
  assert.equal(res.headers.has('access-control-allow-origin'), false);
  const csv = await res.text();
  assert.match(csv, /"""Synthetic"", Parent"/);
  assert.match(csv, /"'\+1 202 555 0100"/);
  assert.equal(csv.includes('submission_id'), false);
  assert.equal(csv.includes('request_fingerprint'), false);
  assert.equal(csv.includes('synthetic-token'), false);
  assert.equal(csv.includes(h.env.ADMIN_TOKEN), false);
});

test('admin rejects absent/wrong credentials, CORS, query tokens and non-GET', async () => {
  const h = harness();
  for (const Authorization of [null, '', 'Bearer wrong', 'Basic wrong']) {
    const res = await h.worker.fetch(h.request(undefined, { method: 'GET', path: '/admin/export',
      headers: { Origin: null, Authorization } }), h.env);
    assert.equal(res.status, 401); assert.equal((await res.text()).includes('parent@example.test'), false);
  }
  assert.equal((await h.admin({ headers: { Origin: ORIGIN } })).status, 403);
  assert.equal((await h.admin({ path: '/admin/export?token=synthetic' })).status, 400);
  assert.equal((await h.admin({ method: 'POST' })).status, 405);
  h.env.ADMIN_TOKEN = '';
  assert.equal((await h.admin()).status, 401);
  h.env.ADMIN_TOKEN = 'REPLACE_WITH_INDEPENDENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS';
  assert.equal((await h.admin()).status, 401);
});

test('CSV cells neutralize formulas and quote delimiters', () => {
  for (const text of ['=1+1', '+123', '-123', '@SUM(A1)', ' \t=1+1', '\tplain', '\rplain']) {
    assert.ok(csvCell(text).startsWith('"\''));
  }
  assert.equal(csvCell('Synthetic, "Parent"'), '"Synthetic, ""Parent"""');
});

test('large admin exports fail instead of being silently truncated', async () => {
  const h = harness({ env: { DB: { prepare() { return { bind() { return {
    all: async () => ({ success: true, results: Array.from({ length: 10001 }, () => ({})) }),
  }; } }; } } } });
  const res = await h.admin();
  assert.equal(res.status, 413); assert.deepEqual(await res.json(), { ok: false, error: 'export_too_large' });
});


test('admin storage errors do not disclose database details', async () => {
  const h = harness({ env: { DB: { prepare() { throw new Error('Synthetic private database error'); } } } });
  const res = await h.admin();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, error: 'storage_unavailable' });
});
