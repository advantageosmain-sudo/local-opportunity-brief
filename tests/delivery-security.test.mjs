// Independent route regression tests. All provider requests are mocked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
test('actual hosted delivery guards concurrency, current customer state and immutable packets', async () => {
    const { default: worker } = await import(root + '/dist/server/index.js');
    class D1 {
        constructor() { this.db = new DatabaseSync(':memory:'); this.beforeRun = null; }
        prepare(sql) { const db = this.db; const beforeRun = (sql, args) => this.beforeRun?.(sql, args); let args = []; const api = { bind(...v) { args = v; return api; }, _run() { beforeRun(sql, args); const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; }, async run() { return api._run(); }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; return api; }
        async batch(stmts) { this.db.exec('BEGIN'); try {
            const out = stmts.map(s => s._run());
            this.db.exec('COMMIT');
            return out;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        } }
    }
    const db = new D1();
    const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) }, OWNER_EMAIL: 'owner@example.com', REPORT_SYNC_SECRET: 'unit-secret', LIVE_DELIVERY: '1', RESEND_API_KEY: 'unit-not-real', DELIVERY_FROM_EMAIL: 'unit@resend.dev' };
    const ctx = { waitUntil() { }, passThroughOnException() { } };
    const call = (p, b, extraHeaders = {}) => worker.fetch(new Request('https://localhost' + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer unit-secret', ...extraHeaders }, ...(b ? { body: JSON.stringify(b) } : {}) }), env, ctx);
    await call('/api/internal/operations');
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    let n = 0;
    const makeReport = () => { const slug = 'unit-customer-' + (++n); const r = { schemaVersion: 1, reportId: slug + '-' + today, generatedAt: new Date().toISOString(), asOf: today, weekOf: today, customer: { slug, businessName: 'UNIT TEST ONLY', deliveryEmail: 'unit@resend.dev', location: { city: 'Olympia', state: 'WA', radiusMiles: 35 }, deliveryMode: 'customer', marketId: 'unit-market' }, fixture: false, status: 'PENDING_APPROVAL', lookaheadDays: 30, deliveryEligible: true, summary: 'Unit test', opportunities: Array.from({ length: 5 }, (_, i) => ({ id: 'unit-' + i, title: 'Unit test ' + i, score: 80, daysAway: 4, eventDate: future, prepareBy: today, location: 'Olympia, WA', distanceMiles: 1, marketId: 'unit-market', why: 'Unit test', offer: 'Unit test', firstAction: 'Unit test', caption: 'Unit test', emailSubject: 'Unit test', emailBody: 'Unit test', guidance: 'Unit test', evidence: { sourceUrl: 'https://www.olympiawa.gov/unit-test-only-' + i, sourceName: 'UNIT TEST ONLY', checkedAt: today, authority: 'official-government', accessStatus: 'verified', confidence: 'high' } })), safeguards: { liveDelivery: false, ownerApprovalRequired: true } }; r.checksum = createHash('sha256').update(JSON.stringify(r)).digest('hex'); return r; };
    const install = async (r, { status = 'active', reportStatus = 'owner_approved', approved = true } = {}) => { db.db.prepare("INSERT OR IGNORE INTO markets(id,city,state,zip,first_approved_at,status) VALUES('unit-market','Olympia','WA','98501',?,'verified')").run(today); db.db.prepare("INSERT INTO customers(id,email,business_name,profile_json,market_id,payment_status,onboarding_status,status,first_delivered_at,require_every_review) VALUES(?,?,?,?,?,'active','complete',?,?,0)").run(r.customer.slug, 'unit@resend.dev', 'UNIT TEST ONLY', JSON.stringify({ deliveryConsent: true }), 'unit-market', status, today); db.db.prepare('INSERT INTO reports(id,customer_slug,business_name,week_of,status,report_json) VALUES(?,?,?,?,?,?)').run(r.reportId, r.customer.slug, r.customer.businessName, r.weekOf, reportStatus, JSON.stringify({ schemaVersion: 1, report: r, validation: { passed: true, errors: [] } })); if (approved)
        db.db.prepare("INSERT INTO report_decisions VALUES(?,?,'approve','owner@example.com',?,'unit test')").run(r.reportId, r.checksum, today); };
    const payload = r => ({ reportId: r.reportId, checksum: r.checksum });
    const originalFetch = globalThis.fetch;
    try {
        let sends = 0;
        globalThis.fetch = async (url) => { if (String(url) !== 'https://api.resend.com/emails')
            throw Error('Network is prohibited in this unit harness'); sends++; return Response.json({ id: 'unit-message-' + sends }); };
        const { validateCurrentReportPacket } = await import(root + "/lib/report-sync.mjs");
        assert.equal((await validateCurrentReportPacket({ schemaVersion: 1, report: makeReport(), validation: { passed: true, errors: [] } })).passed, true);
        let r = makeReport();
        await install(r);
        const concurrent = await Promise.all([call('/api/internal/automation/deliver', payload(r)), call('/api/internal/automation/deliver', payload(r))]);
        assert.equal(sends, 1);
        assert.deepEqual(concurrent.map(x => x.status).sort(), [200, 409]);
        r = makeReport();
        await install(r, { status: 'paused' });
        assert.equal((await call('/api/internal/automation/deliver', payload(r))).status, 409);
        r = makeReport();
        await install(r, { status: 'canceled' });
        assert.equal((await call('/api/internal/automation/deliver', payload(r))).status, 409);
        r = makeReport();
        await install(r, { reportStatus: 'needs_revision', approved: false });
        const rejected = await call('/api/internal/automation/deliver', payload(r));
        assert.equal(rejected.status, 409);
        r = makeReport();
        await install(r);
        globalThis.fetch = async () => { sends++; throw Error('unit network unknown'); };
        const unknown = await call('/api/internal/automation/deliver', payload(r));
        assert.equal(unknown.status, 502);
        assert.equal((await call('/api/internal/automation/deliver', payload(r))).status, 409);
        assert.equal(db.db.prepare('SELECT status FROM delivery_attempts WHERE report_id=?').get(r.reportId).status, 'unknown');
        r = makeReport();
        await install(r);
        let lateCancel = false;
        db.beforeRun = (sql) => { if (!lateCancel && sql.includes('INSERT OR IGNORE INTO delivery_attempts')) {
            lateCancel = true;
            db.db.prepare("UPDATE customers SET status='canceled' WHERE id=?").run(r.customer.slug);
        } };
        globalThis.fetch = async () => { sends++; return Response.json({ id: 'unit-late-cancel' }); };
        const late = await call('/api/internal/automation/deliver', payload(r));
        assert.equal(late.status, 409, 'Cancellation committed before claim must prevent the send');
        assert.equal(db.db.prepare('SELECT status FROM delivery_attempts WHERE report_id=?').get(r.reportId), undefined);
        db.beforeRun = null;
        // QA isolation must be checked both before and atomically during the claim.
        for (const variant of [
            { status: 'test', payment: 'test_active', profile: { isTest: true, deliveryConsent: false } },
            { status: 'active', payment: 'active', profile: { isTest: true, deliveryConsent: true } },
            { status: 'active', payment: 'active', profile: { deliveryConsent: false } },
        ]) {
            r = makeReport(); await install(r);
            db.db.prepare('UPDATE customers SET status=?,payment_status=?,profile_json=? WHERE id=?').run(variant.status,variant.payment,JSON.stringify(variant.profile),r.customer.slug);
            const before = sends;
            assert.equal((await call('/api/internal/automation/deliver',payload(r))).status,409);
            assert.equal(sends,before,'QA or unconsented records never reach even the mock provider');
        }
        for (const profile of [{isTest:true,deliveryConsent:true},{isTest:false,deliveryConsent:false}]) {
            r = makeReport(); await install(r); let changed = false;
            db.beforeRun = sql => { if (!changed && sql.includes('INSERT OR IGNORE INTO delivery_attempts')) {
                changed = true;
                db.db.prepare('UPDATE customers SET profile_json=? WHERE id=?').run(JSON.stringify(profile),r.customer.slug);
            }};
            const before = sends;
            assert.equal((await call('/api/internal/automation/deliver',payload(r))).status,409);
            assert.equal(sends,before,'A last-moment QA flag or consent revocation must block the atomic claim');
            assert.equal(db.db.prepare('SELECT id FROM delivery_attempts WHERE report_id=?').get(r.reportId),undefined);
            db.beforeRun = null;
        }
        r = makeReport();
        r.opportunities = [null, null, null, null, null];
        delete r.checksum;
        r.checksum = createHash('sha256').update(JSON.stringify(r)).digest('hex');
        const malformed = await call('/api/internal/reports', { schemaVersion: 1, report: r, validation: { passed: true, errors: [] } });
        assert.equal(malformed.status, 400, 'Caller-provided validation must not admit structurally invalid reports');
        r = makeReport();
        const originalPacket = { schemaVersion: 1, report: r, validation: { passed: true, errors: [] } };
        const edited = structuredClone(r);
        edited.summary = 'Conflicting contents';
        delete edited.checksum;
        edited.checksum = createHash('sha256').update(JSON.stringify(edited)).digest('hex');
        const sync = await Promise.all([call('/api/internal/reports', originalPacket), call('/api/internal/reports', { ...originalPacket, report: edited })]);
        assert.deepEqual(sync.map(x => x.status).sort(), [201, 409]);
        const expected = sync[0].status === 201 ? r.checksum : edited.checksum;
        assert.equal(JSON.parse(db.db.prepare('SELECT report_json FROM reports WHERE id=?').get(r.reportId).report_json).report.checksum, expected);
        // Invoice timestamps belong to invoice objects; they cannot reactivate a canceled subscription.
        r = makeReport();
        await install(r);
        db.db.prepare("UPDATE customers SET subscription_id='unit-sub-cancel' WHERE id=?").run(r.customer.slug);
        Object.assign(env, {PAYMENTS_PROVIDER:'lemon_squeezy',PAYMENTS_MODE:'live', LIVE_CHECKOUT_VERIFIED:'1', LEMON_SQUEEZY_VARIANT_ID:'unit-variant', LEMON_SQUEEZY_WEBHOOK_SECRET:'unit-webhook-secret'});
        const signedEvent = async (eventName, attributes, type, id) => {
            const body={meta:{event_name:eventName},data:{id,type,attributes:{test_mode:false,...attributes}}};
            return call('/api/webhooks/lemon-squeezy',body,{'x-event-name':eventName,'x-signature':createHmac('sha256','unit-webhook-secret').update(JSON.stringify(body)).digest('hex')});
        };
        const cancelAt=new Date(Date.now()-60_000).toISOString();
        const invoiceAt=new Date(Date.now()-30_000).toISOString();
        assert.equal((await signedEvent('subscription_cancelled',{status:'cancelled',variant_id:'unit-variant',updated_at:cancelAt},'subscriptions','unit-sub-cancel')).status,200);
        assert.equal(db.db.prepare('SELECT payment_status FROM customers WHERE id=?').get(r.customer.slug).payment_status,'canceled');
        assert.equal((await signedEvent('subscription_payment_success',{subscription_id:'unit-sub-cancel',status:'paid',updated_at:invoiceAt},'subscription-invoices','unit-invoice-cancel')).status,200);
        assert.equal(db.db.prepare('SELECT payment_status FROM customers WHERE id=?').get(r.customer.slug).payment_status,'canceled','A newer invoice success must not reactivate cancellation');
        // An owner-only test receipt must not establish first-customer delivery history.
        db.db.prepare("UPDATE delivery_attempts SET created_at=datetime('now','-31 days')").run();
        r=makeReport();
        r.customer.deliveryMode='owner_review_only';
        r.customer.marketId='unit-owner-market';
        r.deliveryEligible=false;
        for(const opportunity of r.opportunities) opportunity.marketId='unit-owner-market';
        delete r.checksum;
        r.checksum=createHash('sha256').update(JSON.stringify(r)).digest('hex');
        await install(r);
        db.db.prepare("INSERT INTO markets(id,city,state,zip,status) VALUES('unit-owner-market','Olympia','WA','98501','verified')").run();
        db.db.prepare("UPDATE customers SET market_id='unit-owner-market',first_delivered_at=NULL WHERE id=?").run(r.customer.slug);
        globalThis.fetch=async(url,options)=>{
            assert.equal(String(url),'https://api.resend.com/emails');
            assert.deepEqual(JSON.parse(options.body).to,['owner@example.com']);
            return Response.json({id:'unit-owner-only-message'});
        };
        assert.equal((await call('/api/internal/automation/deliver',payload(r))).status,200);
        globalThis.fetch=async(url)=>{
            assert.equal(String(url),'https://api.resend.com/emails/unit-owner-only-message');
            return Response.json({id:'unit-owner-only-message',last_event:'delivered'});
        };
        assert.equal((await call('/api/internal/automation/reconcile-delivery',{})).status,200);
        assert.equal(db.db.prepare('SELECT first_delivered_at FROM customers WHERE id=?').get(r.customer.slug).first_delivered_at,null,'Owner-only tests cannot establish customer delivery');
        assert.equal(db.db.prepare("SELECT first_approved_at FROM markets WHERE id='unit-owner-market'").get().first_approved_at,null,'Owner-only tests cannot establish customer market delivery');
    }
    finally {
        globalThis.fetch = originalFetch;
        db.db.close();
    }
});

