// Actual built dashboard with synthetic SQLite rows; no provider or live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { customerDeliveryGate } from '../lib/customer-lifecycle.mjs';
const { default: worker } = await import('../dist/server/index.js');

class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) {
    let args = [];
    const q = {
      bind(...values) { args = values; return q; },
      run: async () => ({ meta: { changes: Number(this.db.prepare(sql).run(...args).changes) } }),
      first: async () => this.db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: this.db.prepare(sql).all(...args) }),
    };
    return q;
  }
  async batch(statements) { return Promise.all(statements.map(s => s.run())); }
}

test('dashboard excludes damaged QA identities and test payment states from customers, subscriptions and real controls', async t => {
  const db = new D1(); t.after(() => db.db.close());
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, OWNER_EMAIL: 'owner@example.com', REPORT_SYNC_SECRET: 'unit-only', PAYMENTS_MODE: 'disabled' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  await worker.fetch(new Request('https://localhost/api/internal/operations', { headers: { authorization: 'Bearer unit-only' } }), env, ctx);
  db.db.prepare("INSERT INTO markets(id,city,state,zip,status) VALUES('unit-market','Olympia','WA','98501','verified')").run();
  const realId = 'a'.repeat(64);
  const realProfile = JSON.stringify({ isTest: false, checkoutToken: 'unit-secret-capability', deliveryConsent: true,
    city: 'Olympia', state: 'WA', localRadius: 35, products: 'gifts', customers: 'adults', voice: 'factual', exclusions: '' });
  const rows = [
    [realId, realProfile, 'active', 'REAL CUSTOMER'],
    ['qa-' + 'b'.repeat(64), '{broken', 'active', 'QA DAMAGED JSON'],
    ['qa-' + 'c'.repeat(64), '{}', 'active', 'QA MISSING FLAG'],
    ['qa-' + 'd'.repeat(64), 'null', 'active', 'QA NULL PROFILE'],
    ['e'.repeat(64), '{"isTest":false}', 'test_qa', 'QA PAYMENT MARKER'],
    ['f'.repeat(64), '{broken', 'test_active', 'QA TEST SUBSCRIPTION'],
    ['g'.repeat(64), '{"isTest":true}', 'active', 'QA PROFILE MARKER'],
    ['qa-' + 'h'.repeat(64), realProfile, 'active', 'QA REPAIRED UNFLAGGED PROFILE'],
  ];
  for (const [id, profile, payment, name] of rows) {
    db.db.prepare("INSERT INTO customers(id,email,business_name,profile_json,market_id,payment_status,onboarding_status,status) VALUES(?,?,?,?,?,?,'complete','active')")
      .run(id, 'synthetic@example.com', name, profile, 'unit-market', payment);
  }
  const response = await worker.fetch(new Request('https://localhost/dashboard', { headers: { 'oai-authenticated-user-email': 'owner@example.com', accept: 'text/html' } }), env, ctx);
  assert.equal(response.status, 200);
  const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(html, /<h2>Customers · 1<\/h2>/);
  assert.match(html, /Active subscriptions: 1/);
  assert.match(html, /<h2>Owner-only QA records · 7<\/h2>/);
  for (const [id, , , name] of rows.slice(1)) {
    assert.ok(html.includes(name), name);
    assert.doesNotMatch(html, new RegExp(`name="customerId"[^>]*value="${id}"`), `${name} must not expose real-customer controls`);
  }
  assert.match(html, new RegExp(`name="customerId"[^>]*value="${realId}"`));
  const snapshot = await worker.fetch(new Request('https://localhost/api/internal/operations', { headers: { authorization: 'Bearer unit-only' } }), env, ctx);
  assert.equal(snapshot.status, 200, 'damaged QA JSON must not break the owner snapshot');
  const snapshotText = await snapshot.text();
  assert.doesNotMatch(snapshotText, /checkoutToken|unit-secret-capability/);
  const summary = JSON.parse(snapshotText).summary;
  assert.equal(summary.customerCount, 1);
  assert.equal(summary.activeSubscriptions, 1);
  const exported = await worker.fetch(new Request('https://localhost/api/internal/automation/customers', { headers: { authorization: 'Bearer unit-only' } }), env, ctx);
  assert.equal(exported.status, 200, 'QA JSON must not fail SQL or enter automation');
  assert.deepEqual((await exported.json()).customers.map(c => c.customerId), [realId]);
  const repairedQa = db.db.prepare('SELECT * FROM customers WHERE id=?').get('qa-' + 'h'.repeat(64));
  const gate = customerDeliveryGate(repairedQa, { marketApproved: true, reportApproved: true, reportValid: true });
  assert.equal(gate.allowed, false, 'direct delivery must honor QA identity even when flags are lost');
  assert.ok(gate.errors.includes('QA_CUSTOMER_NOT_DELIVERABLE'));
});

test('automation export omits structurally damaged profiles and retains a valid customer', async t => {
  const db = new D1(); t.after(() => db.db.close());
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, REPORT_SYNC_SECRET: 'unit-only', PAYMENTS_MODE: 'disabled' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const request = path => new Request('https://localhost' + path, { headers: { authorization: 'Bearer unit-only' } });
  await worker.fetch(request('/api/internal/operations'), env, ctx);
  const valid = { city: 'Olympia', state: 'WA', products: 'gifts', customers: 'adults', voice: 'factual', exclusions: '', localRadius: 35 };
  const damaged = [{}, { ...valid, products: 42 }, { ...valid, customers: [] }, { ...valid, city: null },
    { ...valid, voice: {} }, { ...valid, localRadius: '35' }, null, []];
  db.db.prepare("INSERT INTO markets(id,city,state,zip,status) VALUES('unit-market','Olympia','WA','98501','verified')").run();
  const realId = 'a'.repeat(64);
  for (const [index, profile] of [valid, ...damaged].entries()) {
    const id = index === 0 ? realId : index.toString(16).padStart(64, '0');
    db.db.prepare("INSERT INTO customers(id,email,business_name,profile_json,market_id,payment_status,onboarding_status,status) VALUES(?,?,?,?,?,'active','complete','active')")
      .run(id, 'synthetic@example.com', 'STRUCTURAL PROFILE TEST', JSON.stringify(profile), 'unit-market');
  }
  const response = await worker.fetch(request('/api/internal/automation/customers'), env, ctx);
  assert.equal(response.status, 200, 'one damaged row must not block the whole export');
  const customers = (await response.json()).customers;
  assert.deepEqual(customers.map(c => c.customerId), [realId]);
  assert.deepEqual(customers[0].products, ['gifts']);
  assert.deepEqual(customers[0].customers, ['adults']);
});
