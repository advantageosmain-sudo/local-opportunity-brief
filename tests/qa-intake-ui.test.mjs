import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('owner QA page requires matching authenticated owner',()=>{const s=readFileSync('app/dashboard/qa-intake/page.tsx','utf8');assert.match(s,/getChatGPTUser/);assert.match(s,/user.email.toLowerCase\(\) !== owner/);assert.match(s,/No service agreement/);});
test('QA form uses dedicated owner endpoint without customer consent claims',()=>{const s=readFileSync('components/qa-intake-form.tsx','utf8');assert.match(s,/\/api\/owner\/qa-intake/);assert.match(s,/qaAcknowledged/);assert.doesNotMatch(s,/name="(?:consent|termsAccepted|deliveryConsent)"/);assert.match(s,/OWNER-ONLY TEST/);});
