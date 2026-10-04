import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapabilities } from '../scripts/validate-capabilities.mjs';

test('repo skills and custom agents have paired instructions, permissions and verification examples', async () => {
  const result = await validateCapabilities();
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.skillCount, 3);
  assert.equal(result.agentCount, 3);
  assert.equal(result.businessName, 'Local Opportunity Brief');
});
