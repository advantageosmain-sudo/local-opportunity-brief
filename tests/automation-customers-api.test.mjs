// Built Worker + real in-memory SQLite; no provider or hosted database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {sourcePacks} from './fixtures/source-packs.mjs';

const { default: worker } = await import('../dist/server/index.js');
const path = '/api/internal/automation/customers';
const authorization = 'Bearer synthetic-source-registry-test';
const profile = {
  city: 'Olympia', state: 'WA', localRadius: 35,
  products: 'gifts, apparel', customers: 'local shoppers, visitors',
  voice: 'factual', exclusions: 'no unverified claims',
};
const validPacks = sourcePacks('synthetic-market');

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
  const seed = (id, sourceRegistry = JSON.stringify(sourcePacks('market-' + id)), overrides = {}) => {
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

function expectedCustomer(id, packs = sourcePacks('market-' + id)) {
  return {
    slug: id, customerId: id, businessName: 'Synthetic ' + id,
    deliveryEmail: id + '@example.com', deliveryMode: 'customer', status: 'active',
    subscriptionStatus: 'active', paymentStatus: 'active', intakeComplete: true,
    paused: false, emailSuppressed: false, marketId: 'market-' + id,
    location: { city: 'Olympia', state: 'WA', radiusMiles: 35 },
    products: ['gifts', 'apparel'], customers: ['local shoppers', 'visitors'],
    voice: ['factual'], exclusions: ['no unverified claims'], approvedSourceFiles: [],
    sourcePacks: packs, ownerApprovalRequired: false,
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
      blockedSourceCount: 1, blockedSources: [{customerSlug:'malformed',marketId:'market-malformed',code:'MARKET_SOURCE_INVALID'}],
    }));
    assert.equal(s.snapshot(), before, 'Export must not repair or mutate stored rows');
  });
}

test('current assessment blocks empty or invalid evidence even with saved approval', async t => {
  const s = setup(t);
  await s.initialize();
  const packs = [{ opportunities: [{ arbitrary: true }] }, { opportunities: [] }];
  s.seed('empty', '[]');
  s.seed('shape-only', JSON.stringify(packs));
  assert.equal(await (await s.call()).text(), JSON.stringify({
    customers: [], blockedSourceCount: 2, blockedSources: [
      {customerSlug:'empty',marketId:'market-empty',code:'MARKET_SOURCE_INVALID'},
      {customerSlug:'shape-only',marketId:'market-shape-only',code:'MARKET_SOURCE_INVALID'},
    ],
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

for (const age of [13, 14, 15]) test(`saved source approval does not override age ${age} eligibility or mutate stored state`, async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T12:00:00.000Z')});
  const s=setup(t);await s.initialize();
  const checkedAt=new Date(Date.parse('2026-10-18T00:00:00Z')-age*86400000).toISOString().slice(0,10);
  const packs=sourcePacks('market-boundary',{asOf:'2026-10-18',checkedAt});
  s.seed('boundary',JSON.stringify(packs));const before=s.snapshot();
  const body=await (await s.call()).json();
  assert.deepEqual(body,age<14?{customers:[expectedCustomer('boundary',packs)]}:{customers:[],blockedSourceCount:1,blockedSources:[{customerSlug:'boundary',marketId:'market-boundary',code:'MARKET_SOURCE_FRESHNESS_EXPIRED'}]});
  assert.equal(s.snapshot(),before,'Freshness assessment cannot rewrite saved approval, checked dates or registry bytes');
  if(age>=14)assert.doesNotMatch(JSON.stringify(body),/email|profile|Synthetic|sourcePacks|sourceCheckedAt/);
});

for(const marker of ['slug','profile','payment'])test('expired sources do not leak QA records through blocked diagnostics: '+marker,async t=>{
  const s=setup(t);await s.initialize();
  const asOf=new Date().toISOString().slice(0,10),checkedAt=new Date(Date.parse(asOf)-15*86400000).toISOString().slice(0,10);
  s.seed('hidden',JSON.stringify(sourcePacks('market-hidden',{asOf,checkedAt})));
  if(marker==='slug')s.db.db.prepare("UPDATE customers SET id='qa-hidden',profile_json='{damaged'").run();
  if(marker==='profile')s.db.db.prepare('UPDATE customers SET profile_json=?').run(JSON.stringify({...profile,isTest:true}));
  if(marker==='payment')s.db.db.prepare("UPDATE customers SET payment_status='test_active'").run();
  assert.deepEqual(await (await s.call()).json(),{customers:[]});
});

for(const [label,expired,invalid,code] of [
 ['stale only',true,false,'MARKET_SOURCE_FRESHNESS_EXPIRED'],
 ['invalid only',false,true,'MARKET_SOURCE_INVALID'],
 ['stale and invalid authority',true,true,'MARKET_SOURCE_INVALID'],
 ['current valid',false,false,null],
])test('source export gives truthful fixed diagnostics for '+label,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T12:00:00.000Z')});
 const s=setup(t);await s.initialize();
 const packs=sourcePacks('market-combined',{asOf:'2026-10-18',checkedAt:expired?'2026-10-04':'2026-10-18'});
 if(invalid)packs[0].opportunities[0].sourceAuthority='PRIVATE_UNAPPROVED_AUTHORITY';
 s.seed('combined',JSON.stringify(packs));const before=s.snapshot();
 const body=await (await s.call()).json();
 assert.deepEqual(body,code?{customers:[],blockedSourceCount:1,blockedSources:[{customerSlug:'combined',marketId:'market-combined',code}]}:{customers:[expectedCustomer('combined',packs)]});
 assert.equal(s.snapshot(),before);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_UNAPPROVED_AUTHORITY/);
});

test('mixed source defects never expose QA identities or rewrite their evidence',async t=>{
 const s=setup(t);await s.initialize();
 const packs=sourcePacks('market-hidden',{checkedAt:'2020-01-01'});packs[0].opportunities[0].sourceAuthority='PRIVATE_QA_DEFECT';
 s.seed('hidden',JSON.stringify(packs),{profile_json:JSON.stringify({...profile,isTest:true})});
 const before=s.snapshot();assert.deepEqual(await (await s.call()).json(),{customers:[]});assert.equal(s.snapshot(),before);
});
