// Exercise the actual TypeScript route with in-memory SQLite and mocked HTTP.
// No build, provider credentials, network requests or repository writes required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const routeSource = readFileSync(new URL('../app/api/internal/automation/reconcile-delivery/route.ts', import.meta.url), 'utf8');
const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mockKey = 'unit-test-not-a-real-provider-key';

function harness(t, { deliveryMode = 'customer', liveDelivery = '0', apiKey = mockKey } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE delivery_attempts(id TEXT PRIMARY KEY, report_id TEXT UNIQUE, provider_message_id TEXT, recipient TEXT, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT '2000-01-01');
    CREATE TABLE reports(id TEXT PRIMARY KEY, customer_slug TEXT, report_json TEXT, status TEXT, delivered_at TEXT);
    CREATE TABLE customers(id TEXT PRIMARY KEY, email TEXT, market_id TEXT, first_delivered_at TEXT, delivery_status TEXT);
    CREATE TABLE markets(id TEXT PRIMARY KEY, first_approved_at TEXT);
    CREATE TABLE diagnostics(id TEXT PRIMARY KEY,system TEXT,subject_id TEXT,code TEXT,status TEXT DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  sqlite.prepare("INSERT INTO delivery_attempts(id,report_id,provider_message_id,recipient,status) VALUES('attempt1','report1','message1','owner@example.com','accepted')").run();
  sqlite.prepare("INSERT INTO reports VALUES('report1','customer1',?,'email_accepted',NULL)").run(JSON.stringify({ report: { customer: { deliveryMode } } }));
  sqlite.prepare("INSERT INTO customers VALUES('customer1','owner@example.com','market1',NULL,'pending')").run();
  sqlite.prepare("INSERT INTO markets VALUES('market1',NULL)").run();
  const db = {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  let databaseReads = 0;
  const exports = {};
  const require = (name) => {
    if (name === '@/db/runtime') return { ensureDatabase: async () => { databaseReads++; return db; }, getRuntimeEnv: () => ({ RESEND_API_KEY: apiKey, LIVE_DELIVERY: liveDelivery }) };
    if (name === '@/lib/internal-auth') return { isAutomationRequest: (request) => request.headers.get('authorization') === 'Bearer unit-sync-secret' };
    throw new Error(`Unexpected test import: ${name}`);
  };
  new Function('exports', 'require', routeCode)(exports, require);
  t.after(() => sqlite.close());
  return {
    sqlite,
    get databaseReads() { return databaseReads; },
    call(authorized = true) { return exports.POST(new Request('https://unit.local/api/internal/automation/reconcile-delivery', { method: 'POST', headers: authorized ? { authorization: 'Bearer unit-sync-secret' } : {} })); },
    attempt() { return sqlite.prepare('SELECT * FROM delivery_attempts WHERE id=?').get('attempt1'); },
    customer() { return sqlite.prepare('SELECT * FROM customers WHERE id=?').get('customer1'); },
  };
}

test('receipt route rejects unauthorized requests and missing provider configuration without fetching', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No provider request expected'));
  const unauthorized = harness(t);
  assert.equal((await unauthorized.call(false)).status, 401);
  assert.equal(unauthorized.databaseReads, 0);
  const unconfigured = harness(t, { apiKey: '' });
  assert.equal((await unconfigured.call()).status, 503);
  assert.equal(unconfigured.databaseReads, 0);
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`provider HTTP ${status} fails visibly without retrying, leaking or clearing the delivery lock`, async (t) => {
    const h = harness(t);
    const provider = t.mock.method(globalThis, 'fetch', async () => new Response('private-provider-body', { status, headers: { 'x-private-header': 'private-header-value' } }));
    const result = await h.call();
    assert.equal(result.status, 502);
    const body = await result.json();
    assert.equal(body.code, `PROVIDER_RECEIPT_HTTP_${status}`);
    assert.equal(body.checked, 1);
    assert.equal(body.confirmed, 0);
    assert.equal(provider.mock.callCount(), 1);
    assert.equal(h.attempt().status, 'accepted');
    assert.equal(h.customer().first_delivered_at, null);
    const diagnostic = h.sqlite.prepare("SELECT * FROM diagnostics WHERE id='reconcile-report1'").get();
    assert.equal(diagnostic.status, 'open');
    assert.equal(diagnostic.code, body.code);
    assert.doesNotMatch(JSON.stringify({ body, diagnostic }), /private-provider|private-header|owner@example|unit-test-not-a-real/);
  });
}

for (const [name, response, expectedCode] of [
  ['network failure', () => { throw new Error('private-network-detail'); }, 'PROVIDER_RECEIPT_REQUEST_FAILED'],
  ['invalid JSON', () => new Response('not-json'), 'PROVIDER_RECEIPT_INVALID_JSON'],
  ['null payload', () => Response.json(null), 'PROVIDER_RECEIPT_ID_MISMATCH'],
  ['mismatched ID', () => Response.json({ id: 'other', last_event: 'delivered' }), 'PROVIDER_RECEIPT_ID_MISMATCH'],
  ['missing event', () => Response.json({ id: 'message1' }), 'PROVIDER_RECEIPT_STATUS_INVALID'],
  ['unknown event', () => Response.json({ id: 'message1', last_event: 'unrecognized' }), 'PROVIDER_RECEIPT_STATUS_INVALID'],
]) {
  test(`${name} becomes a safe persistent diagnostic`, async (t) => {
    const h = harness(t);
    t.mock.method(globalThis, 'fetch', response);
    const result = await h.call();
    assert.equal(result.status, 502);
    assert.equal((await result.json()).code, expectedCode);
    assert.equal(h.attempt().status, 'accepted');
    assert.equal(h.sqlite.prepare("SELECT code FROM diagnostics WHERE id='reconcile-report1'").get().code, expectedCode);
  });
}

test('readback uses bounded no-redirect requests and resolves recovered read failures without enabling sends', async (t) => {
  const h = harness(t, { liveDelivery: '0' });
  h.sqlite.prepare("INSERT INTO diagnostics(id,system,subject_id,code) VALUES('reconcile-report1','email','report1','PROVIDER_RECEIPT_HTTP_401')").run();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails/message1');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${mockKey}`);
    assert.ok(!options.method || options.method === 'GET');
    return Response.json({ id: 'message1', last_event: 'delivered' });
  });
  const response = await h.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checked: 1, confirmed: 1, failed: 0 });
  assert.equal(h.attempt().status, 'delivered');
  assert.ok(h.customer().first_delivered_at);
  assert.ok(h.sqlite.prepare("SELECT first_approved_at FROM markets WHERE id='market1'").get().first_approved_at);
  assert.equal(h.sqlite.prepare("SELECT status FROM diagnostics WHERE id='reconcile-report1'").get().status, 'resolved');
  assert.equal((await (await h.call()).json()).confirmed, 0, 'Do not recount previously delivered receipts');
});

for (const event of ['suppressed', 'bounced', 'complained', 'failed']) {
  test(`${event} persists delivery failure and suppresses future customer delivery`, async (t) => {
    const h = harness(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'message1', last_event: event }));
    assert.deepEqual(await (await h.call()).json(), { checked: 1, confirmed: 0, failed: 1 });
    assert.equal(h.attempt().status, 'failed');
    assert.equal(h.customer().delivery_status, 'suppressed');
    assert.equal(h.customer().first_delivered_at, null);
    assert.equal(h.sqlite.prepare("SELECT code FROM diagnostics WHERE id='delivery-report1'").get().code, 'PROVIDER_DELIVERY_FAILED');
  });
}

test('canceled provider message is terminal without suppressing a valid recipient', async (t) => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'message1', last_event: 'canceled' }));
  assert.equal((await (await h.call()).json()).failed, 1);
  assert.equal(h.attempt().status, 'failed');
  assert.equal(h.customer().delivery_status, 'pending');
});

for (const event of ['queued', 'scheduled', 'sent', 'delivery_delayed']) {
  test(`${event} stays pending and rotates its check timestamp`, async (t) => {
    const h = harness(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'message1', last_event: event }));
    assert.deepEqual(await (await h.call()).json(), { checked: 1, confirmed: 0, failed: 0 });
    assert.equal(h.attempt().status, 'accepted');
    assert.notEqual(h.attempt().updated_at, '2000-01-01');
    assert.equal(h.customer().first_delivered_at, null);
  });
}

for (const event of ['delivered', 'suppressed']) {
  test(`owner-only ${event} receipt cannot alter customer or market delivery eligibility`, async (t) => {
    const h = harness(t, { deliveryMode: 'owner_review_only' });
    t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'message1', last_event: event }));
    assert.equal((await h.call()).status, 200);
    assert.equal(h.customer().first_delivered_at, null);
    assert.equal(h.customer().delivery_status, 'pending');
    assert.equal(h.sqlite.prepare("SELECT first_approved_at FROM markets WHERE id='market1'").get().first_approved_at, null);
  });
}

test('claimed and unknown sends stay outside automatic reconciliation', async (t) => {
  const h = harness(t);
  h.sqlite.prepare("UPDATE delivery_attempts SET status='unknown'").run();
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unknown send must stay locked for owner review'));
  assert.deepEqual(await (await h.call()).json(), { checked: 0, confirmed: 0, failed: 0 });
  assert.equal(h.attempt().status, 'unknown');
});

