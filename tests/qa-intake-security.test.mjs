// Synthetic isolated Worker tests; these requests do not accept any real agreement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const { default: worker } = await import('../dist/server/index.js');
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) {
    let args = [];
    const run = () => { const r = this.db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; };
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

test('QA intake cannot collide with public identities or inherit real legal consent', async t => {
  const db = new D1(); t.after(() => db.db.close());
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, OWNER_EMAIL: 'owner@example.com', REPORT_SYNC_SECRET: 'unit-sync',
    PAYMENTS_PROVIDER: 'lemon_squeezy', PAYMENTS_MODE: 'test', LEMON_SQUEEZY_CHECKOUT_URL: 'https://unit.lemonsqueezy.com/checkout/buy/unit-variant' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (path, body, headers = {}) => worker.fetch(new Request('https://localhost' + path, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, ctx);
  const fields = { contactName: 'SYNTHETIC UNIT TEST', businessName: 'SYNTHETIC QA COLLISION TEST', city: 'Olympia', state: 'WA', zip: '98501',
    category: 'boutique', products: 'gifts', customers: 'adult shoppers', voice: 'factual', localRadius: '35' };
  // The pipe is permitted in an email local part. Former string-prefix hashing collided here.
  const publicResponse = await call('/api/intake', { ...fields, email: 'owner-qa|owner@example.com', consent: 'yes', deliveryConsent: 'yes', termsAccepted: 'yes', noGuaranteeAccepted: 'yes' });
  assert.equal(publicResponse.status, 201);
  const publicResult = await publicResponse.json();
  assert.match(publicResult.customerId, /^[a-f0-9]{64}$/);
  const payload = { ...fields, email: 'owner@example.com', qaAcknowledged: 'yes', consent: 'yes', deliveryConsent: 'yes', termsAccepted: 'yes', noGuaranteeAccepted: 'yes' };
  const owner = { 'oai-authenticated-user-email': 'owner@example.com', origin: 'https://localhost' };
  assert.equal((await call('/api/owner/qa-intake', payload)).status, 403);
  assert.equal((await call('/api/owner/qa-intake', payload, { ...owner, origin: 'https://attacker.example' })).status, 403);
  const qaResponse = await call('/api/owner/qa-intake', payload, owner);
  assert.equal(qaResponse.status, 201);
  const qaResult = await qaResponse.json();
  assert.match(qaResult.customerId, /^qa-[a-f0-9]{64}$/);
  assert.notEqual(qaResult.customerId, publicResult.customerId);
  assert.equal(qaResult.checkoutToken, undefined);
  const row = db.db.prepare('SELECT * FROM customers WHERE id=?').get(qaResult.customerId);
  const profile = JSON.parse(row.profile_json);
  for (const field of ['termsAccepted', 'deliveryConsent', 'noGuaranteeAccepted', 'legalConsentRecorded']) assert.equal(profile[field], false, field);
  assert.equal(profile.isTest, true);
  assert.equal(profile.checkoutToken, undefined);
  assert.equal(profile.consentRecordedAt, undefined);
  assert.equal(row.payment_status, 'test_qa');
  assert.equal(row.status, 'test');
  assert.match(row.market_id, /^qa-/);
  assert.equal((await call('/api/checkout', { customerId: row.id, checkoutToken: '' })).status, 400);
  const duplicate = await call('/api/owner/qa-intake', payload, owner);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  for (const flag of ['qa', 'isTest', 'syntheticAcknowledgement', 'qaAcknowledged']) {
    assert.equal((await call('/api/intake', { ...fields, email: 'owner@example.com', [flag]: true })).status, 400);
  }
  const snapshot = await (await call('/api/internal/operations', null, { authorization: 'Bearer unit-sync' })).json();
  assert.equal(snapshot.summary.customerCount, 1);
  // A conflicting/corrupt stored identity must not be represented as a synthetic duplicate.
  db.db.prepare('UPDATE customers SET profile_json=? WHERE id=?').run(JSON.stringify({ ...profile, isTest: false }), row.id);
  assert.equal((await call('/api/owner/qa-intake', payload, owner)).status, 409);
});

