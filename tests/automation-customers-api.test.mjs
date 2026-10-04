// Built Worker + real in-memory SQLite; no provider or hosted database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { default: worker } = await import('../dist/server/index.js');
const path = '/api/internal/automation/customers';
const authorization = 'Bearer synthetic-source-registry-test';
const profile = {
  city: 'Olympia', state: 'WA', localRadius: 35,
  products: 'gifts, apparel', customers: 'local shoppers, visitors',
  voice: 'factual', exclusions: 'no unverified claims',
};
const validPacks = [{
  sourceFile: 'synthetic-registry.json', marketId: 'synthetic-market', fixture: false,
  opportunities: [{ id: 'synthetic-event', title: 'Synthetic event', extra: { order: [2, 1] } }],
  extra: { retained: true, unicode: 'Café', nullValue: null },
}, { opportunities: [], extra: 'keep pack order and empty opportunity arrays' }];

class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) {
    let args = [];
    const query = {
      bind(...values) { args = values; return query; },
      run: async () => ({ meta: { changes: Number(this.db.prepare(sql).run(...args).changes) } }),
      first: async () => this.db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: this.db.prepare(sql).all(...args) }),
    };
    return query;
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function setup(t) {
  const db = new D1();
  t.after(() => db.db.close());
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound request'); });
  const env = {
    DB: db, REPORT_SYNC_SECRET: 'synthetic-source-registry-test',
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = (headers = { authorization }) => worker.fetch(
    new Request('https://localhost' + path, { headers }), env, ctx,
  );
  const insert = (table, row) => db.db.prepare(
    `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`,
  ).run(...Object.values(row));
  const seed = (id, sourceRegistry = JSON.stringify(validPacks), overrides = {}) => {
    insert('markets', {
      id: 'market-' + id, city: profile.city, state: profile.state, zip: '98501',
      source_registry_json: sourceRegistry, status: 'verified', first_approved_at: '2026-10-01T00:00:00Z',
    });
    insert('customers', {
      id, email: id + '@example.com', business_name: 'Synthetic ' + id,
      profile_json: JSON.stringify(profile), market_id: 'market-' + id,
      status: 'active', payment_status: 'active', onboarding_status: 'complete',
      delivery_status: 'pending', require_every_review: 0,
      first_delivered_at: '2026-10-01T00:00:00Z', ...overrides,
    });
  };
  const snapshot = () => JSON.stringify(['customers', 'markets'].map(table =>
    db.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  const initialize = async () => {
    const response = await call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { customers: [] });
  };
  return { db, env, call, seed, snapshot, initialize };
}

function expectedCustomer(id, sourcePacks = validPacks) {
  return {
    slug: id, customerId: id, businessName: 'Synthetic ' + id,
    deliveryEmail: id + '@example.com', deliveryMode: 'customer', status: 'active',
    subscriptionStatus: 'active', paymentStatus: 'active', intakeComplete: true,
    paused: false, emailSuppressed: false, marketId: 'market-' + id,
    location: { city: 'Olympia', state: 'WA', radiusMiles: 35 },
    products: ['gifts', 'apparel'], customers: ['local shoppers', 'visitors'],
    voice: ['factual'], exclusions: ['no unverified claims'], approvedSourceFiles: [],
    sourcePacks, ownerApprovalRequired: false,
  };
}

for (const headers of [{}, { authorization: 'Bearer wrong-secret' }]) {
  test('customer export rejects ' + (headers.authorization ? 'wrong' : 'missing') + ' credentials before database work', async t => {
    const s = setup(t);
    assert.equal((await s.call(headers)).status, 401);
    assert.equal(s.db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
  });
}

test('valid customer and source pack export retains exact response bytes and stored data', async t => {
  const s = setup(t);
  await s.initialize();
  s.seed('valid');
  const before = s.snapshot();
  const response = await s.call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), JSON.stringify({ customers: [expectedCustomer('valid')] }));
  assert.equal(s.snapshot(), before);
});

const malformedRegistries = [
  ['invalid JSON', '['],
  ...[
    ['null registry', null], ['object registry', {}], ['string registry', 'bad'],
    ['number registry', 1], ['boolean registry', false],
    ['null pack', [null]], ['array pack', [[]]], ['string pack', ['bad']],
    ['number pack', [1]], ['boolean pack', [false]],
    ['missing opportunities', [{}]], ['null opportunities', [{ opportunities: null }]],
    ['string opportunities', [{ opportunities: 'bad' }]],
    ['object opportunities', [{ opportunities: {} }]],
    ['number opportunities', [{ opportunities: 1 }]],
    ['boolean opportunities', [{ opportunities: false }]],
    ['null opportunity', [{ opportunities: [null] }]],
    ['number opportunity', [{ opportunities: [42] }]],
    ['string opportunity', [{ opportunities: ['bad'] }]],
    ['array opportunity', [{ opportunities: [[]] }]],
    ['boolean opportunity', [{ opportunities: [false] }]],
    ['valid and null opportunities', [{ opportunities: [...validPacks[0].opportunities, null] }]],
    ['malformed first pack', [null, ...validPacks]],
    ['malformed middle pack', [validPacks[0], { opportunities: 'bad' }, validPacks[1]]],
    ['malformed last pack', [...validPacks, null]],
  ].map(([name, value]) => [name, JSON.stringify(value)]),
];

for (const [name, registry] of malformedRegistries) {
  test('customer export omits the whole row for ' + name + ' and preserves other customers', async t => {
    const s = setup(t);
    await s.initialize();
    s.seed('valid-before');
    s.seed('malformed', registry);
    s.seed('valid-after');
    const before = s.snapshot();
    const response = await s.call();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), JSON.stringify({
      customers: [expectedCustomer('valid-before'), expectedCustomer('valid-after')],
    }));
    assert.equal(s.snapshot(), before, 'Export must not repair or mutate stored rows');
  });
}

test('shape validation preserves empty registries and leaves opportunity semantics to report validation', async t => {
  const s = setup(t);
  await s.initialize();
  const packs = [{ opportunities: [{ arbitrary: true }] }, { opportunities: [] }];
  s.seed('empty', '[]');
  s.seed('shape-only', JSON.stringify(packs));
  assert.equal(await (await s.call()).text(), JSON.stringify({
    customers: [expectedCustomer('empty', []), expectedCustomer('shape-only', packs)],
  }));
});

test('a missing market is excluded until actual source coverage is reviewed', async t => {
  const s = setup(t);
  await s.initialize();
  s.seed('missing-market');
  s.db.db.prepare('DELETE FROM markets').run();
  assert.equal(await (await s.call()).text(), JSON.stringify({
    customers: [], blockedSourceCount: 1, blockedSources: [{ customerSlug: 'missing-market', marketId: 'market-missing-market', code: 'MARKET_SOURCE_MISSING' }],
  }));
});

for (const status of ['pending_review', 'source_discovery_required']) {
  test('paid active customer with '+status+' market gets explicit blocked-service diagnostics, never an eligible profile', async t => {
    const s=setup(t);await s.initialize();s.seed('blocked');s.db.db.prepare('UPDATE markets SET status=?').run(status);
    const body=await (await s.call()).json();assert.deepEqual(body,{customers:[],blockedSourceCount:1,blockedSources:[{customerSlug:'blocked',marketId:'market-blocked',code:'MARKET_SOURCE_APPROVAL_REQUIRED'}]});
    assert.doesNotMatch(JSON.stringify(body),/email|profile|Synthetic|sourcePacks/);
    s.db.db.prepare("UPDATE customers SET id='qa-blocked',payment_status='test_active',status='test'").run();assert.deepEqual(await (await s.call()).json(),{customers:[]});
  });
}
