import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));

test('live checklist distinguishes the recorded final deployment from unproven historical observations', () => {
  const evidence = read('evidence/live-site-e2e-2026-10-02.json');
  const deployment = read('evidence/sites-deployment-2026-10-02.json').public_site;
  const binding = evidence.deployment_binding;
  assert.equal(binding.target_deployment_id, deployment.deployment_id);
  assert.equal(binding.target_version_id, deployment.version_id);
  assert.equal(binding.target_source_commit, deployment.source_commit);
  assert.notEqual(binding.historical_observation.deployment_id, deployment.deployment_id);
  assert.equal(binding.status, 'UNVERIFIED');
  const home = evidence.checks.find(check => check.stage === 1);
  assert.equal(home.status, 'BLOCKED');
  assert.ok(home.evidence.includes(deployment.deployment_id));
  assert.ok(!home.evidence.includes(binding.historical_observation.deployment_id));
});

test('synthetic QA creation cannot pass the intake-plus-payment customer stage', () => {
  const evidence = read('evidence/live-site-e2e-2026-10-02.json');
  assert.equal(evidence.checks.find(check => check.stage === 9).status, 'BLOCKED');
  for (const stage of [5, 6, 7, 8]) assert.equal(evidence.checks.find(check => check.stage === stage).status, 'BLOCKED');
  assert.equal(evidence.synthetic_qa_record.status, 'PASS');
  assert.equal(evidence.synthetic_qa_record.customer_count, 0);
  assert.equal(evidence.synthetic_qa_record.qa_records, 1);
  assert.equal(evidence.synthetic_qa_record.purchase, false);
  assert.equal(evidence.synthetic_qa_record.legal_consent_created, false);
  assert.equal(evidence.synthetic_qa_record.delivery, false);
});
