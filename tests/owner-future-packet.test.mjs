import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateReportSyncPayload,validateCurrentReportPacket,computeReportChecksum} from '../lib/report-sync.mjs';

const packet=JSON.parse(readFileSync(new URL('../evidence/owner-test-olympia-future-2026-10-03/dashboard-sync.json',import.meta.url),'utf8'));
test('frozen future-only owner packet is immutable and does not grant delivery or customer authority',async()=>{
 const r=packet.report;
 assert.equal(r.reportId,'owner-test-olympia-future-2026-10-03');
 assert.equal(r.checksum,'0d1635457fbe814edbf4e374edffe7978a1629a968fdaedd31929889b923a408');
 assert.equal(await computeReportChecksum(r),r.checksum);
 assert.equal((await validateReportSyncPayload(packet)).passed,true);
 assert.equal(r.customer.deliveryMode,'owner_review_only');assert.equal(r.deliveryEligible,false);assert.equal(r.safeguards.liveDelivery,false);assert.equal(r.status,'PENDING_APPROVAL');
 assert.equal(r.opportunities.length,5);assert.equal(new Set(r.opportunities.map(o=>o.id)).size,5);
 assert.equal(new Set(r.opportunities.map(o=>o.evidence.sourceUrl)).size,5);
 assert.ok(r.opportunities.every(o=>o.eventDate>'2026-10-03'));
});
test('frozen packet freshness is checked for the requested date and expires without silent reapproval',async()=>{
 for(const date of ['2026-10-03T14:00:00Z','2026-10-04T14:00:00Z','2026-10-09T14:00:00Z'])assert.equal((await validateCurrentReportPacket(packet,new Date(date))).passed,true,date);
 assert.equal((await validateCurrentReportPacket(packet,new Date('2026-10-10T14:00:00Z'))).passed,false);
 const altered=structuredClone(packet);altered.report.opportunities[0].eventDate='2026-10-11';assert.equal((await validateReportSyncPayload(altered)).passed,false,'Changing the packet invalidates its approved identity');
});
