// Actual built dashboard with synthetic SQLite rows; no provider or live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
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
  const realId = 'a'.repeat(64);
  const rows = [
    [realId, '{"isTest":false}', 'active', 'REAL CUSTOMER'],
    ['qa-' + 'b'.repeat(64), '{broken', 'active', 'QA DAMAGED JSON'],
    ['qa-' + 'c'.repeat(64), '{}', 'active', 'QA MISSING FLAG'],
    ['qa-' + 'd'.repeat(64), 'null', 'active', 'QA NULL PROFILE'],
    ['e'.repeat(64), '{"isTest":false}', 'test_qa', 'QA PAYMENT MARKER'],
    ['f'.repeat(64), '{broken', 'test_active', 'QA TEST SUBSCRIPTION'],
    ['g'.repeat(64), '{"isTest":true}', 'active', 'QA PROFILE MARKER'],
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
  assert.match(html, /<h2>Owner-only QA records · 6<\/h2>/);
  for (const [id, , , name] of rows.slice(1)) {
    assert.ok(html.includes(name), name);
    assert.doesNotMatch(html, new RegExp(`name="customerId"[^>]*value="${id}"`), `${name} must not expose real-customer controls`);
  }
  assert.match(html, new RegExp(`name="customerId"[^>]*value="${realId}"`));
});
