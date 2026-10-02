import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('public customer pages provide required local-business journey',()=>{for(const p of ['app/contact/page.tsx','app/cancellation/page.tsx','app/terms/page.tsx','app/privacy/page.tsx','app/sample/page.tsx','app/intake/page.tsx'])assert.ok(existsSync(new URL('../'+p,import.meta.url)));assert.match(read('app/page.tsx'),/How it works/);assert.match(read('app/page.tsx'),/United States/);assert.match(read('app/page.tsx'),/49/)});
test('intake explicitly obtains privacy, service, delivery and no-guarantee consent',()=>{const s=read('components/intake-form.tsx');for(const field of ['deliveryConsent','termsAccepted','noGuaranteeAccepted','consent','zip','billingEmail','institutions','currentPromotions','publicLinks','deliveryPreferences'])assert.ok(s.includes('name="'+field+'"'));assert.match(s,/type="email"/);assert.match(s,/form-status-error/)});
test('sample never claims current verified events',()=>{const s=read('app/sample/page.tsx');assert.match(s,/real research, illustrative customer/);assert.match(s,/not refreshed automatically as a live calendar/);assert.match(s,/Source publication date: not displayed/)});
test('public footer separates private owner workspace',()=>{assert.match(read('components/footer.tsx'),/https:\/\/local-opportunity-owner\.mshipe2022\.chatgpt\.site/)});
