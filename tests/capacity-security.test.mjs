// Actual Worker + SQLite capacity regressions; no real provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { reserveFoundingPlace } from '../lib/founding-capacity.mjs';
const { default: worker } = await import('../dist/server/index.js');
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.beforeRun = null; }
  prepare(sql) {
    let args = [];
    const run = () => { this.beforeRun?.(sql); const r = this.db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; };
    const q = { bind(...v) { args = v; return q; }, run: async () => run(), _run: run,
      first: async () => this.db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: this.db.prepare(sql).all(...args) }) };
    return q;
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const results = statements.map(s => s._run()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
async function setup(t) {
  const db = new D1();
  t.after(() => db.db.close());
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, REPORT_SYNC_SECRET: 'unit-only', PAYMENTS_MODE: 'test',
    LEMON_SQUEEZY_CHECKOUT_URL: 'https://unit.lemonsqueezy.com/checkout/buy/unit-variant', LEMON_SQUEEZY_WEBHOOK_SECRET: 'unit-webhook', LEMON_SQUEEZY_VARIANT_ID: 'unit-variant' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, body, headers = {}, method = body ? 'POST' : 'GET') => worker.fetch(new Request('https://localhost' + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer unit-only', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, ctx);
  await call('/api/internal/operations');
  const signedPayment = async (subscription, invoice, occurredAt = new Date().toISOString()) => {
    const body = { meta: { event_name: 'subscription_payment_success' }, data: { type: 'subscription-invoices', id: invoice,
      attributes: { test_mode: true, subscription_id: subscription, status: 'paid', updated_at: occurredAt } } };
    return call('/api/webhooks/lemon-squeezy', body, { 'x-event-name': body.meta.event_name,
      'x-signature': createHmac('sha256', 'unit-webhook').update(JSON.stringify(body)).digest('hex') });
  };
  const customer = (id, subscription = null, payment = 'unpaid') => {
    db.db.prepare("INSERT OR IGNORE INTO markets(id,city,state,zip,status) VALUES('unit-market','Olympia','WA','98501','verified')").run();
    db.db.prepare('INSERT INTO customers(id,email,business_name,profile_json,market_id,subscription_id,payment_status) VALUES(?,?,?,?,?,?,?)')
      .run(id, 'unit@example.com', 'UNIT TEST ONLY', JSON.stringify({ checkoutToken: 'unit-checkout' }), 'unit-market', subscription, payment);
  };
  return { db, env, call, signedPayment, customer };
}

test('payment allocation and event dedupe roll back together; replay cannot lose a paid founder', async t => {
  const { db, signedPayment, customer } = await setup(t);
  customer('unit-paid');
  await reserveFoundingPlace(db, 'unit-paid', 'test');
  db.db.prepare("UPDATE customers SET subscription_id='unit-sub' WHERE id='unit-paid'").run();
  let fail = true;
  db.beforeRun = sql => { if (fail && sql.startsWith("UPDATE founding_reservations SET state='paid'")) { fail = false; throw Error('Unit allocation write failure'); } };
  const occurredAt = new Date().toISOString();
  assert.equal((await signedPayment('unit-sub', 'unit-invoice', occurredAt)).status, 503);
  assert.equal(db.db.prepare('SELECT count(*) n FROM payment_events').get().n, 0);
  assert.equal(db.db.prepare('SELECT state FROM founding_reservations').get().state, 'reserved');
  assert.equal((await signedPayment('unit-sub', 'unit-invoice', occurredAt)).status, 200);
  assert.equal(db.db.prepare('SELECT state FROM founding_reservations').get().state, 'paid');
  assert.equal((await (await signedPayment('unit-sub', 'unit-invoice', occurredAt)).json()).status, 'DUPLICATE_IGNORED');
  assert.equal(db.db.prepare('SELECT state FROM founding_reservations').get().state, 'paid');
});

test('a delayed payment after reservation expiry freezes further checkout even when payment occurred before expiry', async t => {
  const { db, signedPayment, customer, call } = await setup(t);
  customer('unit-delayed');
  await reserveFoundingPlace(db, 'unit-delayed', 'test', new Date(Date.now() - 31 * 60_000));
  for (let i = 0; i < 10; i++) await reserveFoundingPlace(db, 'other-' + i, 'test');
  db.db.prepare("UPDATE founding_reservations SET state='paid' WHERE customer_id LIKE 'other-%'").run();
  db.db.prepare("UPDATE customers SET subscription_id='unit-delayed-sub' WHERE id='unit-delayed'").run();
  assert.equal((await signedPayment('unit-delayed-sub', 'unit-delayed-invoice', new Date(Date.now() - 29 * 60_000).toISOString())).status, 200);
  const alert = db.db.prepare("SELECT status,code FROM diagnostics WHERE id='capacity-unit-delayed'").get();
  assert.equal(alert?.status, 'open');
  assert.equal(alert?.code, 'EXPIRED_RESERVATION_PAYMENT_REVIEW_REQUIRED');
  const next = 'a'.repeat(64); customer(next);
  const response = await call('/api/checkout', { customerId: next, checkoutToken: 'unit-checkout' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /reconciliation/i);
});

test('legacy canceled subscription without paid lifetime allocation blocks new founding checkout', async t => {
  const { db, call, customer } = await setup(t);
  customer('unit-legacy', 'unit-legacy-sub', 'test_canceled');
  const next = 'b'.repeat(64); customer(next);
  const response = await call('/api/checkout', { customerId: next, checkoutToken: 'unit-checkout' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /reconciliation/i);
  assert.equal(db.db.prepare('SELECT count(*) n FROM founding_reservations').get().n, 0);
});

test('releasing an unpaid test reservation leaves the live reservation intact', async t => {
  const { db, call, customer } = await setup(t);
  const id = 'c'.repeat(64); customer(id);
  await reserveFoundingPlace(db, id, 'test');
  await reserveFoundingPlace(db, id, 'live');
  assert.equal((await call('/api/checkout', { customerId: id, checkoutToken: 'unit-checkout' }, {}, 'DELETE')).status, 200);
  assert.equal(db.db.prepare("SELECT state FROM founding_reservations WHERE mode='test'").get().state, 'released');
  assert.equal(db.db.prepare("SELECT state FROM founding_reservations WHERE mode='live'").get().state, 'reserved');
});

for (const existing of [false, true]) test(`a capacity audit alert before ${existing ? 'repeat' : 'new'} reservation claim prevents checkout`, async t => {
  const { db, call, customer } = await setup(t);
  const id = 'd'.repeat(64); customer(id);
  if (existing) await reserveFoundingPlace(db, id, 'test');
  let injected = false;
  db.beforeRun = sql => {
    if (!injected && sql.startsWith('INSERT INTO founding_reservations')) {
      injected = true;
      db.db.prepare("INSERT INTO diagnostics(id,system,subject_id,code) VALUES('unit-concurrent-capacity','payments','unit-other','UNRESERVED_PAYMENT_REVIEW_REQUIRED')").run();
    }
  };
  const response = await call('/api/checkout', { customerId: id, checkoutToken: 'unit-checkout' });
  assert.equal(response.status, 409, 'A committed audit freeze must be checked inside the reservation write');
  assert.equal(db.db.prepare('SELECT count(*) n FROM founding_reservations').get().n, existing ? 1 : 0);
});
