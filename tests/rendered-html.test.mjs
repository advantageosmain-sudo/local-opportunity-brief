import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function workerEnv() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

function workerContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

test("renders the public business home page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    workerEnv(),
    workerContext(),
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /Know what(?:’|&#x27;|')s happening/);
  assert.match(
    html,
    /<div class="price"><span>\$<\/span><strong>49<\/strong><span>\/month<\/span><\/div>/,
  );
});

test("renders the complete five-opportunity sample", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/sample", {
      headers: { accept: "text/html" },
    }),
    workerEnv(),
    workerContext(),
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Your five best local opportunities/);
  assert.equal((html.match(/class="opportunity-card"/g) ?? []).length, 5);
  assert.match(html, /DEMONSTRATION DATA ONLY|demonstration uses fictional/i);
});

test("renders the membership request and health endpoint", async () => {
  const worker = await loadWorker();
  const intake = await worker.fetch(
    new Request("http://localhost/intake", {
      headers: { accept: "text/html" },
    }),
    workerEnv(),
    workerContext(),
  );
  assert.equal(intake.status, 200);
  assert.match(await intake.text(), /Submit founding membership request/);

  const health = await worker.fetch(
    new Request("http://localhost/api/health"),
    workerEnv(),
    workerContext(),
  );
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    business: "Local Opportunity Brief",
    status: "ok",
    liveDelivery: false,
    version: "0.1.0",
  });
});
