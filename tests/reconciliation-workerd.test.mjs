// Native Workers fetch, with all provider traffic intercepted and network denied.
// Node-only mocks accept redirect:'error' and cannot catch this runtime mismatch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import ts from 'typescript';

test('actual workerd receipt reads accept signal, reject HTTP failures, and never follow redirects', async (t) => {
  const source = readFileSync(new URL('../app/api/internal/automation/reconcile-delivery/route.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const deliveredEvents =');
  const end = source.indexOf('export async function POST(');
  assert.ok(start >= 0 && end > start, 'Use the actual receipt helper, excluding route imports and database actions');
  const helper = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const script = `${helper}\nexport default {async fetch(request) {
    const messageId = new URL(request.url).pathname.slice(1);
    return Response.json(await readProviderReceipt(messageId, 'SYNTHETIC_RUNTIME_KEY'));
  }};`;
  const providerPaths = [];
  let redirectedRequests = 0;
  const statuses = [200, 301, 302, 303, 307, 308, 403, 500];
  // Intercept the entire native outbound service. Do not proxy it through
  // Node fetch: Node's redirect handling would obscure the Workers behavior.
  const outboundService = async (request) => {
    const url = new URL(request.url);
    if (url.origin === 'https://redirect-sink.invalid') {
      redirectedRequests++;
      return Response.json({});
    }
    assert.equal(url.origin, 'https://api.resend.com', 'All other outbound destinations are blocked');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('authorization'), 'Bearer SYNTHETIC_RUNTIME_KEY');
    const messageId = url.pathname.slice('/emails/'.length);
    const status = Number(messageId.slice('runtime-'.length));
    assert.ok(statuses.includes(status));
    providerPaths.push(messageId);
    return Response.json({ id: messageId, last_event: 'delivered' }, {
      status, headers: { location: 'https://redirect-sink.invalid/capture' },
    });
  };
  const runtime = new Miniflare({
    cf: false, // Never fetch workers.cloudflare.com/cf.json during local tests.
    modules: true, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService, script,
  });
  t.after(async () => { await runtime.dispose(); });
  for (const status of statuses) {
    const messageId = `runtime-${status}`;
    const response = await runtime.dispatchFetch(`http://receipt-worker.invalid/${messageId}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), status === 200
      ? { result: { id: messageId, last_event: 'delivered' } }
      : { code: `PROVIDER_RECEIPT_HTTP_${status}` });
  }
  assert.deepEqual(providerPaths, statuses.map(status => `runtime-${status}`), 'Exactly one native fetch per receipt');
  assert.equal(redirectedRequests, 0, 'No redirect destination can receive the provider credential');
});
