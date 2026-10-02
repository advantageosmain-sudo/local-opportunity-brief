import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const customerId = 'a'.repeat(64);
const qaCustomerId = `qa-${customerId}`;
const capability = { customerId, checkoutToken: 'saved-tab-capability' };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Exercise the actual TSX event handlers with deterministic hooks and browser
// boundaries. No provider calls, new test dependencies, or live credentials.
function harness(componentName, { saved = null, search = '', fetch: mockFetch } = {}) {
  const filename = componentName === 'QaIntakeForm' ? 'qa-intake-form.tsx' : 'intake-form.tsx';
  const source = readFileSync(new URL(`../components/${filename}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const slots = [];
  const listeners = new Map();
  const requests = [];
  const navigations = [];
  const storage = new Map(saved === null ? [] : [['lob-checkout', typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  let hook = 0;
  const react = {
    useState(initial) {
      const index = hook++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = hook++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = hook++;
      if (!(index in slots)) slots[index] = effect();
    },
    useSyncExternalStore(subscribe, snapshot) {
      const index = hook++;
      if (!(index in slots)) slots[index] = subscribe(() => {});
      return snapshot();
    },
  };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    exports: compiled.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return runtime;
      throw new Error(`Unexpected import: ${name}`);
    },
    URL,
    URLSearchParams,
    crypto: { randomUUID: () => 'local-submission-id' },
    FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.values); } },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: {
      location: { search, assign: (url) => navigations.push(url) },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    },
    fetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      return mockFetch ? mockFetch(url, options) : response({ error: 'Disabled for this test.' }, 503);
    },
  }, { filename });
  return {
    requests, navigations, storage,
    render() { hook = 0; return compiled.exports[componentName]({ ownerEmail: 'owner@example.com' }); },
    pageshow(persisted) { for (const callback of listeners.get('pageshow') ?? []) callback({ persisted }); },
    pagehide() { for (const callback of listeners.get('pagehide') ?? []) callback({}); },
  };
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
}
function button(tree, label) {
  const result = nodes(tree).find((node) => node.type === 'button' && text(node) === label);
  assert.ok(result, `Missing button: ${label}`);
  return result;
}
function submit(tree, values = {}) {
  return tree.props.onSubmit({ preventDefault() {}, currentTarget: { values, reset() {} } });
}
async function saveQa(ui) {
  await submit(ui.render(), { qaAcknowledged: 'yes' });
  return ui.render();
}
function restore(ui) {
  button(ui.render(), 'Resume a saved request in this tab').props.onClick();
  return ui.render();
}

test('QA billing is hidden until a successful saved synthetic record, including duplicate records', async () => {
  for (const duplicate of [false, true]) {
    const ui = harness('QaIntakeForm', { fetch: () => response({ customerId: qaCustomerId, isTest: true, duplicate }, duplicate ? 200 : 201) });
    assert.doesNotMatch(text(ui.render()), /Sandbox checkout|Sandbox billing management/);
    const tree = await saveQa(ui);
    for (const label of ['Sandbox checkout (fake money)', 'Sandbox billing management']) {
      assert.equal(button(tree, label).props.type, 'button');
      assert.equal(button(tree, label).props.disabled, false);
    }
    assert.doesNotMatch(JSON.stringify(ui.requests[0].body), /checkoutToken|termsAccepted|deliveryConsent/);
    assert.ok(!nodes(tree).some((node) => ['consent', 'termsAccepted', 'deliveryConsent'].includes(node.props?.name)));
  }
});

test('QA billing stays hidden for failed, non-test, malformed, or public intake IDs', async () => {
  for (const [body, status] of [
    [{ customerId: qaCustomerId, isTest: true, error: 'Owner denied.' }, 403],
    [{ customerId: qaCustomerId }, 201],
    [{ customerId, isTest: true }, 201],
    [{ customerId: 'qa-short', isTest: true }, 201],
  ]) {
    const ui = harness('QaIntakeForm', { fetch: () => response(body, status) });
    assert.doesNotMatch(text(await saveQa(ui)), /Sandbox checkout|Sandbox billing management/);
  }
});

test('QA actions send only the saved ID and block repeated or cross-action clicks through navigation', async () => {
  const pending = deferred();
  const ui = harness('QaIntakeForm', { fetch: (url) => url.endsWith('qa-intake')
    ? response({ customerId: qaCustomerId, isTest: true }, 201)
    : url.endsWith('stripe-checkout') ? pending.promise : response({ url: 'https://billing.stripe.com/p/session_test' }) });
  const tree = await saveQa(ui);
  const checkout = button(tree, 'Sandbox checkout (fake money)');
  const portal = button(tree, 'Sandbox billing management');
  const request = checkout.props.onClick();
  await checkout.props.onClick();
  await portal.props.onClick();
  await submit(tree);
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(ui.requests[1].body, { customerId: qaCustomerId });
  assert.equal(ui.requests[1].url, '/api/owner/stripe-checkout');
  assert.equal(button(ui.render(), 'Sandbox billing management').props.disabled, true);
  pending.resolve(response({ url: 'https://checkout.stripe.com/c/pay/cs_test_example' }));
  await request;
  await checkout.props.onClick();
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(ui.navigations, ['https://checkout.stripe.com/c/pay/cs_test_example']);
  ui.pageshow(true);
  await button(ui.render(), 'Sandbox billing management').props.onClick();
  assert.equal(ui.requests[2].url, '/api/owner/stripe-portal');
  assert.deepEqual(ui.requests[2].body, { customerId: qaCustomerId });
  assert.equal(ui.navigations[1], 'https://billing.stripe.com/p/session_test');
});

test('QA save blocks immediate duplicate submissions and clears billing controls during a new save', async () => {
  const pending = deferred();
  let calls = 0;
  const ui = harness('QaIntakeForm', { fetch: () => ++calls === 1
    ? response({ customerId: qaCustomerId, isTest: true }, 201) : pending.promise });
  await saveQa(ui);
  const tree = ui.render();
  const request = submit(tree);
  await submit(tree);
  assert.equal(ui.requests.length, 2);
  assert.doesNotMatch(text(ui.render()), /Sandbox checkout|Sandbox billing management/);
  pending.resolve(response({ error: 'New test could not be saved.' }, 503));
  await request;
  assert.match(text(ui.render()), /New test could not be saved/);
  assert.doesNotMatch(text(ui.render()), /Sandbox checkout|Sandbox billing management/);
});

test('public saved request restores only its exact capability for checkout and billing management', async () => {
  for (const [label, endpoint, target] of [
    ['Continue to checkout', '/api/checkout', 'https://checkout.stripe.com/c/pay/cs_test_example'],
    ['Manage billing', '/api/billing/portal', 'https://billing.stripe.com/p/session_test'],
  ]) {
    const ui = harness('IntakeForm', { saved: { ...capability, isTest: true, admin: true }, fetch: () => response({ url: target }) });
    assert.doesNotMatch(text(ui.render()), /Manage billing/);
    const tree = restore(ui);
    const action = button(tree, label);
    assert.equal(action.props.type, 'button');
    await action.props.onClick();
    assert.equal(ui.requests[0].url, endpoint);
    assert.deepEqual(ui.requests[0].body, capability);
    assert.deepEqual(ui.navigations, [target]);
    assert.equal(button(ui.render(), 'Manage billing').props.disabled, true);
  }
});

test('public intake persists the returned capability and blocks repeated submits', async () => {
  const pending = deferred();
  const ui = harness('IntakeForm', { fetch: () => pending.promise });
  const tree = ui.render();
  const request = submit(tree, { contactName: 'Test' });
  await submit(tree, { contactName: 'Test' });
  assert.equal(ui.requests.length, 1);
  pending.resolve(response({ ...capability, message: 'Saved.' }, 201));
  await request;
  assert.deepEqual(JSON.parse(ui.storage.get('lob-checkout')), capability);
  assert.equal(button(ui.render(), 'Manage billing').props.disabled, false);
});

test('public billing blocks repeated clicks and allows retry after provider error or browser Back', async () => {
  const pending = deferred();
  let calls = 0;
  const ui = harness('IntakeForm', { saved: capability, fetch: () => ++calls === 1 ? pending.promise : response({ url: 'https://billing.stripe.com/p/session_test' }) });
  const tree = restore(ui);
  const portal = button(tree, 'Manage billing');
  const request = portal.props.onClick();
  await portal.props.onClick();
  await button(tree, 'Continue to checkout').props.onClick();
  await submit(tree);
  assert.equal(ui.requests.length, 1);
  pending.resolve(response({ error: 'No billing account exists yet.' }, 409));
  await request;
  assert.match(text(ui.render()), /No billing account exists yet/);
  assert.equal(button(ui.render(), 'Manage billing').props.disabled, false);
  await button(ui.render(), 'Manage billing').props.onClick();
  assert.equal(ui.navigations.length, 1);
  ui.pageshow(true);
  assert.equal(button(ui.render(), 'Manage billing').props.disabled, false);
  await button(ui.render(), 'Manage billing').props.onClick();
  assert.equal(ui.requests.length, 3);
});

test('billing redirects reject unsafe protocols, wrong hosts, user info and nondefault ports', async () => {
  for (const componentName of ['QaIntakeForm', 'IntakeForm']) {
    for (const action of ['checkout', 'portal']) {
      const expected = action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
      const other = action === 'checkout' ? 'billing.stripe.com' : 'checkout.stripe.com';
      for (const url of [
        `http://${expected}/session`, `https://${expected}.evil.example/session`, `https://${other}/session`,
        `https://user@${expected}/session`, `https://${expected}:444/session`, 'javascript:alert(1)', '/relative',
      ]) {
        const ui = harness(componentName, { saved: capability, fetch: (path) => path.endsWith('qa-intake')
          ? response({ customerId: qaCustomerId, isTest: true }, 201) : response({ url }) });
        const tree = componentName === 'QaIntakeForm' ? await saveQa(ui) : restore(ui);
        const label = componentName === 'QaIntakeForm'
          ? action === 'checkout' ? 'Sandbox checkout (fake money)' : 'Sandbox billing management'
          : action === 'checkout' ? 'Continue to checkout' : 'Manage billing';
        await button(tree, label).props.onClick();
        assert.equal(ui.navigations.length, 0, `${componentName} ${action} accepted ${url}`);
        assert.equal(button(ui.render(), label).props.disabled, false);
      }
    }
  }
});

test('API errors and missing links remain visible and re-enable both forms', async () => {
  for (const componentName of ['QaIntakeForm', 'IntakeForm']) {
    for (const result of [response({ error: 'Owner-only sandbox configuration is required.' }, 503), response({})]) {
      const ui = harness(componentName, { saved: capability, fetch: (path) => path.endsWith('qa-intake')
        ? response({ customerId: qaCustomerId, isTest: true }, 201) : result });
      const tree = componentName === 'QaIntakeForm' ? await saveQa(ui) : restore(ui);
      const label = componentName === 'QaIntakeForm' ? 'Sandbox billing management' : 'Manage billing';
      await button(tree, label).props.onClick();
      assert.match(text(ui.render()), /Owner-only sandbox configuration is required|No (?:sandbox )?billing link/);
      assert.equal(button(ui.render(), label).props.disabled, false);
      assert.equal(ui.navigations.length, 0);
    }
  }
});

test('checkout return is informational and never treats a query parameter as payment confirmation', () => {
  const ui = harness('IntakeForm', { search: '?checkout=complete&session_id=untrusted', saved: capability });
  const rendered = text(ui.render());
  assert.match(rendered, /Payment confirmation is pending a verified Stripe webhook/);
  assert.match(rendered, /does not confirm payment or start service/);
  assert.doesNotMatch(rendered, /\bpaid\b|\bactive\b/i);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.navigations.length, 0);
  assert.doesNotMatch(text(harness('IntakeForm', { search: '?checkout=cancelled' }).render()), /Payment confirmation is pending/);
});

test('malformed or absent saved capabilities cannot expose public billing actions', () => {
  for (const saved of [null, '{bad', {}, { customerId }, { ...capability, customerId: qaCustomerId }, { ...capability, checkoutToken: '' }]) {
    const ui = harness('IntakeForm', { saved });
    const tree = restore(ui);
    assert.doesNotMatch(text(tree), /Manage billing|Continue to checkout/);
    assert.match(text(tree), /could not be restored|No checkout request is saved/);
    assert.equal(ui.requests.length, 0);
  }
});



test('interrupted navigation discards stale redirects without unlocking a newer billing action', async () => {
  for (const componentName of ['QaIntakeForm', 'IntakeForm']) {
    const older = deferred();
    const newer = deferred();
    const ui = harness(componentName, { saved: capability, fetch: (path) => path.endsWith('qa-intake')
      ? response({ customerId: qaCustomerId, isTest: true }, 201)
      : path.endsWith('checkout') ? older.promise : newer.promise });
    const tree = componentName === 'QaIntakeForm' ? await saveQa(ui) : restore(ui);
    const checkoutLabel = componentName === 'QaIntakeForm' ? 'Sandbox checkout (fake money)' : 'Continue to checkout';
    const portalLabel = componentName === 'QaIntakeForm' ? 'Sandbox billing management' : 'Manage billing';
    const first = button(tree, checkoutLabel).props.onClick();
    ui.pagehide();
    ui.pageshow(true);
    const second = button(ui.render(), portalLabel).props.onClick();
    older.resolve(response({ url: 'https://checkout.stripe.com/c/pay/stale' }));
    await first;
    assert.equal(ui.navigations.length, 0);
    assert.equal(button(ui.render(), portalLabel).props.disabled, true);
    newer.resolve(response({ url: 'https://billing.stripe.com/p/current' }));
    await second;
    assert.deepEqual(ui.navigations, ['https://billing.stripe.com/p/current']);
  }
});
