// Exercise the actual TypeScript route with in-memory SQLite and mocked HTTP.
// No build, provider credentials, network requests or repository writes required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

const routeSource = readFileSync(new URL('../app/api/internal/automation/reconcile-delivery/route.ts', import.meta.url), 'utf8');
const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const identityExports = {};
const identitySource = readFileSync(new URL('../lib/owner-rehearsal.ts', import.meta.url), 'utf8');
new Function('exports', ts.transpileModule(identitySource, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(identityExports);
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
    if (name === '@/lib/owner-rehearsal') return identityExports;
    throw new Error(`Unexpected test import: ${name}`);
  };
  new Function('exports', 'require', routeCode)(exports, require);
  t.after(() => sqlite.close());
  return {
    sqlite,
    get databaseReads() { return databaseReads; },
    addAttempt(number, { status = 'accepted', updatedAt = '2000-01-01', messageId = `message${number}` } = {}) {
      sqlite.prepare('INSERT INTO delivery_attempts(id,report_id,provider_message_id,recipient,status,updated_at) VALUES(?,?,?,?,?,?)')
        .run(`attempt${number}`, `report${number}`, messageId, 'owner@example.com', status, updatedAt);
      sqlite.prepare("INSERT INTO reports VALUES(?,'customer1',?,'email_accepted',NULL)")
        .run(`report${number}`, JSON.stringify({ report: { customer: { deliveryMode } } }));
    },
    call(authorized = true) { return exports.POST(new Request('https://unit.local/api/internal/automation/reconcile-delivery', { method: 'POST', headers: authorized ? { authorization: 'Bearer unit-sync-secret' } : {} })); },
    attempt() { return sqlite.prepare('SELECT * FROM delivery_attempts WHERE id=?').get('attempt1'); },
    customer() { return sqlite.prepare('SELECT * FROM customers WHERE id=?').get('customer1'); },
  };
}

function useClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  return async (milliseconds) => {
    t.mock.timers.tick(milliseconds);
    await setImmediate();
  };
}

async function finishPacedPass(h, tick) {
  const response = h.call();
  await setImmediate();
  for (let index = 0; index < 3; index++) await tick(600);
  return response;
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
    assert.deepEqual(body, { error: 'Provider receipt could not be verified.', code: `PROVIDER_RECEIPT_HTTP_${status}`, checked: 1, confirmed: 0, failed: 0 });
    assert.equal(provider.mock.callCount(), 1);
    assert.equal(h.attempt().status, 'accepted');
    assert.notEqual(h.attempt().updated_at, '2000-01-01');
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
    assert.notEqual(h.attempt().updated_at, '2000-01-01');
    assert.equal(h.sqlite.prepare("SELECT code FROM diagnostics WHERE id='reconcile-report1'").get().code, expectedCode);
  });
}

for (const status of [200, 403]) {
  test(`missing AbortSignal.throwIfAborted does not mask provider HTTP ${status}`, async (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted');
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { configurable: true, value: undefined });
    t.after(() => {
      if (descriptor) Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', descriptor);
      else delete AbortSignal.prototype.throwIfAborted;
    });
    const h = harness(t);
    const response = status === 200 ? Response.json({ id: 'message1', last_event: 'delivered' }) : new Response('private-denial-body', { status });
    const json = t.mock.method(response, 'json');
    const provider = t.mock.method(globalThis, 'fetch', async () => response);
    const result = await h.call();
    const body = await result.json();
    assert.equal(provider.mock.callCount(), 1);
    assert.equal(result.status, status === 200 ? 200 : 502);
    assert.equal(h.attempt().status, status === 200 ? 'delivered' : 'accepted');
    if (status === 403) {
      assert.equal(body.code, 'PROVIDER_RECEIPT_HTTP_403');
      assert.equal(json.mock.callCount(), 0, 'A rejected provider response body must never be read');
      assert.equal(h.customer().first_delivered_at, null);
    } else assert.equal(json.mock.callCount(), 1);
    assert.doesNotMatch(JSON.stringify(body), /private-denial|owner@example|unit-test-not-a-real/);
  });
}

for (const readingBody of [false, true]) {
  const stage = readingBody ? 'BODY' : 'REQUEST';
  for (const [name, makeError, suffix] of [
    ['known transport code', () => Object.assign(new Error('private-network-detail'), { code: 'ECONNRESET' }), 'TRANSPORT_ERROR'],
    ['known nested transport code', () => new TypeError('private-network-detail', { cause: Object.assign(new Error('private-cause'), { code: 'UND_ERR_SOCKET' }) }), 'TRANSPORT_ERROR'],
    ['abort', () => new DOMException('private-abort-detail', 'AbortError'), 'ABORTED'],
    ['unsupported runtime', () => Object.assign(new Error('private-runtime-detail'), { code: 'UND_ERR_NOT_SUPPORTED' }), 'RUNTIME_UNSUPPORTED'],
    ['ambiguous TypeError', () => new TypeError('private-runtime-network-or-redirect-detail'), 'TYPE_ERROR'],
    ['unknown name and code', () => Object.assign(new Error('private-detail'), { name: 'private-name', code: 'private-code', cause: { code: 'private-cause' } }), readingBody ? 'READ_FAILED' : 'FAILED'],
  ]) {
    test(`${stage.toLowerCase()} ${name} uses only a fixed safe diagnostic`, async (t) => {
      const h = harness(t);
      const provider = t.mock.method(globalThis, 'fetch', async () => {
        if (!readingBody) throw makeError();
        return { ok: true, json: async () => { throw makeError(); } };
      });
      const result = await h.call();
      const body = await result.json();
      const expectedCode = `PROVIDER_RECEIPT_${stage}_${suffix}`;
      assert.equal(result.status, 502);
      assert.equal(body.code, expectedCode);
      assert.equal(provider.mock.callCount(), 1);
      assert.equal(h.attempt().status, 'accepted');
      assert.equal(h.customer().first_delivered_at, null);
      const diagnostic = h.sqlite.prepare("SELECT * FROM diagnostics WHERE id='reconcile-report1'").get();
      assert.equal(diagnostic.code, expectedCode);
      assert.doesNotMatch(JSON.stringify({ body, diagnostic }), /private-|owner@example|unit-test-not-a-real/);
    });
  }
}

test('fetch redirect rejection represented only as TypeError remains explicitly ambiguous', async (t) => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
  });
  const result = await h.call();
  assert.equal(result.status, 502);
  assert.equal((await result.json()).code, 'PROVIDER_RECEIPT_REQUEST_TYPE_ERROR');
  assert.equal(h.attempt().status, 'accepted');
});

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

for (const status of ['claimed', 'unknown']) {
  test(`${status} sends stay outside automatic reconciliation`, async (t) => {
    const h = harness(t);
    h.sqlite.prepare('UPDATE delivery_attempts SET status=?').run(status);
    t.mock.method(globalThis, 'fetch', () => assert.fail('Uncertain send must stay locked for owner review'));
    assert.deepEqual(await (await h.call()).json(), { checked: 0, confirmed: 0, failed: 0 });
    assert.equal(h.attempt().status, status);
    assert.equal(h.attempt().updated_at, '2000-01-01');
  });
}

test('a missing message ID has a safe one-row 502 contract and rotates without a provider request', async (t) => {
  const h = harness(t);
  h.sqlite.prepare('UPDATE delivery_attempts SET provider_message_id=NULL').run();
  t.mock.method(globalThis, 'fetch', () => assert.fail('No provider ID to request'));
  const response = await h.call();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Provider receipt could not be verified.', code: 'PROVIDER_MESSAGE_ID_MISSING', checked: 0, confirmed: 0, failed: 0 });
  assert.equal(h.attempt().status, 'accepted');
  assert.notEqual(h.attempt().updated_at, '2000-01-01');
});

for (const [name, fail, expectedCode] of [
  ['missing ID', null, 'PROVIDER_MESSAGE_ID_MISSING'],
  ['permanent HTTP failure', () => new Response('private-provider-body', { status: 404 }), 'PROVIDER_RECEIPT_HTTP_404'],
  ['transport failure', () => { throw new Error('private-network-detail'); }, 'PROVIDER_RECEIPT_REQUEST_FAILED'],
  ['malformed JSON', () => new Response('private-not-json'), 'PROVIDER_RECEIPT_INVALID_JSON'],
  ['mismatched ID', () => Response.json({ id: 'private-other-message', last_event: 'delivered' }), 'PROVIDER_RECEIPT_ID_MISMATCH'],
  ['invalid status', () => Response.json({ id: 'message1', last_event: 'private-unrecognized' }), 'PROVIDER_RECEIPT_STATUS_INVALID'],
]) {
  test(`${name} cannot prevent a later valid receipt in the same pass`, async (t) => {
    const tick = useClock(t);
    const h = harness(t);
    h.addAttempt(2);
    if (!fail) h.sqlite.prepare("UPDATE delivery_attempts SET provider_message_id=NULL WHERE id='attempt1'").run();
    const provider = t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/message1')
      ? fail()
      : Response.json({ id: 'message2', last_event: 'delivered' }));
    const response = await finishPacedPass(h, tick);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.deepEqual(body, { error: 'Provider receipt could not be verified.', code: expectedCode, checked: fail ? 2 : 1, confirmed: 1, failed: 0 });
    assert.equal(provider.mock.callCount(), fail ? 2 : 1);
    assert.equal(h.attempt().status, 'accepted');
    assert.notEqual(h.attempt().updated_at, '2000-01-01');
    assert.equal(h.sqlite.prepare("SELECT status FROM delivery_attempts WHERE id='attempt2'").get().status, 'delivered');
    const diagnostics = h.sqlite.prepare('SELECT * FROM diagnostics').all();
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, expectedCode);
    assert.doesNotMatch(JSON.stringify({ body, diagnostics }), /private-|owner@example|unit-test-not-a-real/);
  });
}

test('a full batch of permanent failures rotates behind later accepted and delivered receipts on the next pass', async (t) => {
  const tick = useClock(t);
  const h = harness(t);
  for (let number = 2; number <= 5; number++) h.addAttempt(number);
  h.addAttempt(6, { status: 'delivered' });
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const id = url.split('/').at(-1);
    requested.push(id);
    if (id === 'message5') return Response.json({ id, last_event: 'delivered' });
    if (id === 'message6') return Response.json({ id, last_event: 'bounced' });
    return new Response('private-permanent-error', { status: 404 });
  });
  const first = await finishPacedPass(h, tick);
  assert.equal(first.status, 502);
  assert.equal((await first.json()).checked, 4);
  assert.deepEqual(requested, ['message1', 'message2', 'message3', 'message4']);
  const second = await finishPacedPass(h, tick);
  assert.equal(second.status, 502);
  assert.deepEqual(await second.json(), { error: 'Provider receipt could not be verified.', code: 'PROVIDER_RECEIPT_HTTP_404', checked: 4, confirmed: 1, failed: 1 });
  assert.deepEqual(requested.slice(4), ['message5', 'message6', 'message1', 'message2']);
  assert.equal(h.customer().delivery_status, 'suppressed', 'A delivered receipt must still be revisited for a later bounce');
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM diagnostics WHERE code='PROVIDER_RECEIPT_HTTP_404' AND status='open'").get().count, 4);
  for (let number = 1; number <= 4; number++) {
    assert.equal(h.sqlite.prepare('SELECT status FROM delivery_attempts WHERE id=?').get(`attempt${number}`).status, 'accepted');
  }
});

test('batch selection compares SQLite and ISO check timestamps chronologically and excludes the old horizon', async (t) => {
  const h = harness(t);
  h.sqlite.prepare("UPDATE delivery_attempts SET updated_at='2020-01-01T01:00:00.000Z'").run();
  for (let number = 2; number <= 4; number++) h.addAttempt(number, { updatedAt: '2020-01-01 00:00:00', messageId: null });
  h.addAttempt(5, { updatedAt: '2020-01-01 02:00:00', messageId: null });
  h.addAttempt(6);
  h.sqlite.prepare("UPDATE delivery_attempts SET created_at=datetime('now','-31 days') WHERE id='attempt6'").run();
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'message1', last_event: 'sent' }));
  assert.equal((await h.call()).status, 502);
  assert.equal(provider.mock.callCount(), 1, 'The earlier ISO timestamp must be selected before a later SQLite timestamp');
  assert.equal(h.sqlite.prepare("SELECT updated_at FROM delivery_attempts WHERE id='attempt5'").get().updated_at, '2020-01-01 02:00:00');
  assert.equal(h.sqlite.prepare("SELECT updated_at FROM delivery_attempts WHERE id='attempt6'").get().updated_at, '2000-01-01');
});

for (const stalledStage of ['fetch', 'body', 'body after slow headers']) {
  test(`four stalled ${stalledStage} reads finish in 21.8 seconds including pacing even if abort is ignored`, async (t) => {
    const tick = useClock(t);
    const h = harness(t);
    for (let number = 2; number <= 5; number++) h.addAttempt(number);
    const starts = [];
    const signals = [];
    const provider = t.mock.method(globalThis, 'fetch', async (_url, options) => {
      starts.push(Date.now());
      signals.push(options.signal);
      if (stalledStage === 'fetch') return new Promise(() => {});
      if (stalledStage === 'body after slow headers') await new Promise(resolve => setTimeout(resolve, 4_000));
      return { ok: true, json: () => new Promise(() => {}) };
    });
    const startedAt = Date.now();
    let settled = false;
    const responsePromise = h.call().then(response => { settled = true; return response; });
    await setImmediate();
    for (let index = 0; index < 4; index++) {
      assert.equal(provider.mock.callCount(), index + 1);
      assert.equal(signals[index].aborted, false);
      if (stalledStage === 'body after slow headers') await tick(4_000);
      await tick(stalledStage === 'body after slow headers' ? 999 : 4_999);
      assert.equal(signals[index].aborted, false);
      assert.equal(settled, false);
      await tick(1);
      assert.equal(signals[index].aborted, true);
      if (index < 3) {
        await tick(599);
        assert.equal(provider.mock.callCount(), index + 1, 'No request before the pacing interval');
        await tick(1);
      }
    }
    assert.equal(settled, true, 'A stalled provider must not keep the route waiting');
    const response = await responsePromise;
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Provider receipt could not be verified.', code: stalledStage === 'fetch' ? 'PROVIDER_RECEIPT_REQUEST_TIMEOUT' : 'PROVIDER_RECEIPT_BODY_TIMEOUT', checked: 4, confirmed: 0, failed: 0 });
    assert.equal(Date.now() - startedAt, 21_800);
    assert.deepEqual(starts.map(start => start - startedAt), [0, 5_600, 11_200, 16_800]);
    assert.equal(provider.mock.callCount(), 4);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM delivery_attempts WHERE status='accepted'").get().count, 5);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM diagnostics WHERE status='open'").get().count, 4);
    assert.equal(h.sqlite.prepare("SELECT updated_at FROM delivery_attempts WHERE id='attempt5'").get().updated_at, '2000-01-01');
  });
}

test('fast receipt requests are paced below two per second and are capped at four', async (t) => {
  const tick = useClock(t);
  const h = harness(t);
  for (let number = 2; number <= 6; number++) h.addAttempt(number);
  const starts = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    starts.push(Date.now());
    return Response.json({ id: url.split('/').at(-1), last_event: 'delivered' });
  });
  const start = Date.now();
  const response = await finishPacedPass(h, tick);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checked: 4, confirmed: 4, failed: 0 });
  assert.deepEqual(starts.map(value => value - start), [0, 600, 1_200, 1_800]);
});

test('a provider response arriving after the hard deadline cannot change a receipt or clear its diagnostic', async (t) => {
  const tick = useClock(t);
  const h = harness(t);
  let resolveFetch;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveFetch = resolve; }));
  const responsePromise = h.call();
  await setImmediate();
  await tick(5_000);
  assert.equal((await responsePromise).status, 502);
  const afterTimeout = h.attempt();
  resolveFetch(Response.json({ id: 'message1', last_event: 'delivered' }));
  await setImmediate();
  assert.deepEqual(h.attempt(), afterTimeout);
  assert.equal(h.customer().first_delivered_at, null);
  assert.equal(h.sqlite.prepare("SELECT status FROM diagnostics WHERE id='reconcile-report1'").get().status, 'open');
});
