// All feed bytes and HTTPS responses here are synthetic validation fixtures.
// These tests are not evidence of a real event, source ownership or live fetching.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fetchConfiguredSource, ingestConfiguredSources, isPublicAddress, parseIcs, parseRss, validateIngestionConfig, validatePublicUrl, INGESTION_LIMITS } from "../lib/source-ingestion.mjs";
import { validateSourcePack } from "../lib/source-validation.mjs";
const now = new Date("2026-10-02T12:00:00Z");
const source = { id: "mock-city-calendar", name: "Mock city feed", format: "ics", url: "https://calendar.olympiawa.gov/events.ics", authorityClaim: "official-government" };
const config = { marketId: "olympia-wa", location: { city: "Olympia", state: "WA" }, timeZone: "America/Los_Angeles", sources: [source] };
const eventLines = ["UID:mock-fixture-1", "SUMMARY:Mock event\\, not a real recommendation", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261012", "DTSTAMP:20261002T100000Z", "URL:https://calendar.olympiawa.gov/event/fixture-1", "LOCATION:Mock venue"];
const ics = (lines = eventLines) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", ...lines, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
const rss = (extras = "<ev:startdate>2026-10-10T18:00:00-07:00</ev:startdate>", pubDate = "Fri, 02 Oct 2026 10:00:00 GMT") => `<rss version="2.0" xmlns:ev="https://schema.mock-feed.co/events"><channel><title>Mock feed</title><item><title><![CDATA[Mock event & art]]></title><link>https://calendar.olympiawa.gov/event/fixture-2</link><pubDate>${pubDate}</pubDate>${extras}</item></channel></rss>`;
const mockFetch = (text) => async () => ({ text, contentType: "text/calendar" });
function requestFixture({ body = ics(), status = 200, headers = { "content-type": "text/calendar" }, inspect = () => {} } = {}) {
  return (url, options, callback) => {
    inspect(url, options);
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req;
    req.end = () => queueMicrotask(() => { const response = new PassThrough(); response.statusCode = status; response.headers = headers; callback(response); response.end(body); });
    return req;
  };
}

test("explicit HTTPS configuration rejects internal, credentialed, IP and unapproved inputs", () => {
  for (const url of ["http://calendar.olympiawa.gov/", "https://127.0.0.1/feed", "https://2130706433/feed", "https://[::1]/", "https://localhost/feed", "https://x.internal/feed", "https://x.local/feed", "https://user:password@calendar.olympiawa.gov/feed", "https://calendar.olympiawa.gov:8443/feed", "https://calendar.olympiawa.gov/feed#fragment"]) assert.throws(() => validatePublicUrl(url));
  assert.equal(validateIngestionConfig(config), config);
  assert.throws(() => validateIngestionConfig({ ...config, sources: [{ ...source, format: "rss", rssEventDateElement: "pubDate" }] }), /EXPLICIT_EVENT_DATE/);
});

test("private and transition DNS results are rejected before an HTTP request", async () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2001::1234", "2001:0000::1234", "2001:db8::1", "2002:7f00:1::1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
  await assert.rejects(fetchConfiguredSource(source, { configuredUrls: [source.url], resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.1.1.1", family: 4 }], requestImpl: () => assert.fail("No internal request") }), /SOURCE_DNS_NONPUBLIC/);
});

test("HTTP fetch pins approved public DNS while keeping TLS hostname verification", async () => {
  const result = await fetchConfiguredSource(source, { configuredUrls: [source.url], resolve: async () => [{ address: "8.8.8.8", family: 4 }], requestImpl: requestFixture({ inspect: (url, options) => {
    assert.equal(url.href, source.url); assert.equal(options.servername, url.hostname); assert.equal(options.agent, false);
    assert.equal(options.headers["accept-encoding"], "identity");
    options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
  } }) });
  assert.equal(result.text, ics());
  await assert.rejects(fetchConfiguredSource(source, { configuredUrls: [], resolve: () => assert.fail("No DNS") }), /NOT_EXPLICITLY_ALLOWLISTED/);
});

test("redirects, compressed bodies, bad content types and oversized responses fail closed", async () => {
  const opts = { configuredUrls: [source.url], resolve: async () => [{ address: "8.8.8.8", family: 4 }] };
  await assert.rejects(fetchConfiguredSource(source, { ...opts, requestImpl: requestFixture({ status: 302, headers: { location: "https://127.0.0.1/" } }) }), /REDIRECT_BLOCKED/);
  await assert.rejects(fetchConfiguredSource(source, { ...opts, requestImpl: requestFixture({ headers: { "content-type": "text/calendar", "content-encoding": "gzip" } }) }), /ENCODING_UNSUPPORTED/);
  await assert.rejects(fetchConfiguredSource(source, { ...opts, requestImpl: requestFixture({ headers: { "content-type": "text/html" } }) }), /CONTENT_TYPE_UNSUPPORTED/);
  await assert.rejects(fetchConfiguredSource(source, { ...opts, requestImpl: requestFixture({ body: "x".repeat(INGESTION_LIMITS.maxBytes + 1) }) }), /TOO_LARGE/);
});

test("ICS preserves explicit dates, exclusive all-day end and folded text without approval", async () => {
  const result = await ingestConfiguredSources(config, { now, fetchSource: mockFetch(ics(eventLines.map((line) => line.startsWith("SUMMARY") ? "SUMMARY:Mock folded\r\n  title" : line))) });
  assert.equal(result.status, "PENDING_OWNER_SOURCE_VALIDATION"); assert.equal(result.candidateCount, 1);
  const candidate = result.sourcePacks[0].opportunities[0];
  assert.equal(candidate.title, "Mock folded title"); assert.equal(candidate.eventDate, "2026-10-10"); assert.equal(candidate.eventDateEnd, "2026-10-11");
  assert.equal(candidate.sourceAuthority, "unverified"); assert.equal(candidate.sourceAccessStatus, "pending-owner-validation"); assert.equal(candidate.sourceCheckedAt, null);
  assert.equal(candidate.sourcePublishedAt, null); assert.equal(result.liveDelivery, false);
  assert.equal(validateSourcePack(result.sourcePacks[0], { asOf: "2026-10-02" }).passed, false);
  assert.match(candidate.sourceReceipt.bodySha256, /^[a-f0-9]{64}$/);
});

test("ICS recurrence, missing evidence, cancellation, floating and DST-ambiguous time are diagnosed", () => {
  for (const [lines, code] of [
    [[...eventLines, "RRULE:FREQ=WEEKLY"], "ICS_RECURRENCE_UNSUPPORTED"],
    [eventLines.filter((line) => !line.startsWith("DTSTAMP")), "ICS_DATE_MISSING"],
    [[...eventLines, "STATUS:CANCELLED"], "EVENT_CANCELLED"],
    [eventLines.filter((line) => !line.startsWith("DTEND")).map((line) => line.startsWith("DTSTART") ? "DTSTART:20261010T120000" : line), "ICS_FLOATING_OR_UNSUPPORTED_TIMEZONE"],
    [eventLines.filter((line) => !line.startsWith("DTEND")).map((line) => line.startsWith("DTSTART") ? "DTSTART;TZID=America/Los_Angeles:20261101T013000" : line), "ICS_LOCAL_TIME_AMBIGUOUS_OR_NONEXISTENT"],
  ]) assert.equal(parseIcs(ics(lines), config)[0].error, code);
});

test("UTC timestamps use market-local event date rather than UTC day", () => {
  const lines = eventLines.filter((line) => !line.startsWith("DTEND")).map((line) => line.startsWith("DTSTART") ? "DTSTART:20261011T010000Z" : line);
  const event = parseIcs(ics(lines), config)[0]; assert.equal(event.eventDate, "2026-10-10"); assert.equal(event.eventDateTime, "2026-10-11T01:00:00.000Z");
});

test("RSS requires actual configured event date; publication date is never a substitute", () => {
  const opts = { ...config, rssEventDateElement: "ev:startdate" };
  const event = parseRss(rss(), opts)[0]; assert.equal(event.eventDate, "2026-10-10"); assert.equal(event.title, "Mock event & art");
  assert.equal(parseRss(rss(""), opts)[0].error, "RSS_EXPLICIT_EVENT_DATE_MISSING");
  assert.equal(parseRss(rss("<ev:startdate>10/11/2026</ev:startdate>"), opts)[0].error, "TIMESTAMP_AMBIGUOUS_OR_INVALID");
  assert.equal(parseRss(rss(undefined, "Fri, 30 Feb 2026 10:00:00 GMT"), opts)[0].error, "RSS_PUBLICATION_TIMESTAMP_INVALID");
  assert.throws(() => parseRss('<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + rss(), opts), /DTD_OR_ENTITY_FORBIDDEN/);
});

test("stale, future, outside-window, duplicate and non-allowlisted evidence stays blocked", async () => {
  const variants = [
    [eventLines.map((line) => line.startsWith("DTSTAMP") ? "DTSTAMP:20260801T100000Z" : line), "EVIDENCE_TIMESTAMP_STALE"],
    [eventLines.map((line) => line.startsWith("DTSTAMP") ? "DTSTAMP:20261005T100000Z" : line), "EVIDENCE_TIMESTAMP_IN_FUTURE"],
    [eventLines.map((line) => line.startsWith("DTSTART") ? "DTSTART;VALUE=DATE:20260928" : line), "EVENT_OUTSIDE_30_DAY_WINDOW"],
    [eventLines.map((line) => line.startsWith("URL") ? "URL:https://different-real-domain.co/event" : line), "EVENT_URL_NOT_ALLOWLISTED"],
  ];
  for (const [lines, code] of variants) {
    const result = await ingestConfiguredSources(config, { now, fetchSource: mockFetch(ics(lines)) });
    assert.equal(result.status, "BLOCKED"); assert.equal(result.diagnostics[0].code, code);
  }
  const duplicate = ics().replace("END:VCALENDAR", ["BEGIN:VEVENT", ...eventLines, "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  const result = await ingestConfiguredSources(config, { now, fetchSource: mockFetch(duplicate) });
  assert.equal(result.candidateCount, 1); assert.equal(result.diagnostics[0].code, "DUPLICATE_EVENT_EVIDENCE");
});

test("RSS ingestion reuses registry envelope but cannot fabricate geography, fit or approval", async () => {
  const result = await ingestConfiguredSources({ ...config, sources: [{ ...source, format: "rss", rssEventDateElement: "ev:startdate" }] }, { now, fetchSource: mockFetch(rss()) });
  assert.equal(result.marketId, config.marketId); assert.equal(result.sourcePacks.length, 1); assert.equal(result.candidateOnly, true);
  const candidate = result.sourcePacks[0].opportunities[0];
  assert.equal(candidate.proposedCity, "Olympia"); assert.equal(candidate.city, undefined); assert.equal(candidate.customerTags, undefined); assert.equal(candidate.prepareBy, undefined); assert.equal(candidate.sourceQuality, undefined); assert.equal(candidate.ownerApprovalRequired, true);
});
