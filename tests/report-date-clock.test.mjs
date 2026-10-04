import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReportDateKey,isCurrentOwnerReport} from '../lib/dashboard-policy.mjs';

for (const instant of ['2026-10-04T00:01:00Z','2026-03-08T07:30:00Z','2026-11-01T06:30:00Z']) {
 test(`owner report date follows hosted UTC validation at ${instant}`,t=>{
  const now=new Date(instant),today=instant.slice(0,10);
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  assert.equal(currentReportDateKey(),today);
  assert.equal(isCurrentOwnerReport({asOf:today,opportunities:[{eventDate:today}]}),true);
  assert.equal(currentReportDateKey(now),today);
  assert.equal(isCurrentOwnerReport({asOf:today,opportunities:[{eventDate:today}]},currentReportDateKey(now)),true);
  const tomorrow=new Date(now.getTime()+86400000).toISOString().slice(0,10);
  assert.equal(isCurrentOwnerReport({asOf:tomorrow,opportunities:[{eventDate:tomorrow}]},currentReportDateKey(now)),false);
 });
}
