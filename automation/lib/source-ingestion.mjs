// Candidate extraction only. No source authority, event geography or recommendation
// is human-verified by this module, and nothing here grants report/market approval.
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export const INGESTION_LIMITS = Object.freeze({ maxBytes: 1_000_000, timeoutMs: 15_000, maxSources: 10, maxItems: 500, maxEvidenceAgeDays: 14, lookaheadDays: 30 });
const authorities = new Set(["official-government", "official-school", "official-organizer", "official-destination-office", "customer-first-party"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };
const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && Number.isFinite(new Date(`${value}T00:00:00Z`).valueOf()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const days = (a, b) => (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000;
const localDay = (date, timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export function validatePublicUrl(value) {
  let url;
  if (typeof value !== "string" || value.length > 2000) fail("SOURCE_URL_INVALID");
  try { url = new URL(value); } catch { fail("SOURCE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) fail("SOURCE_URL_UNSAFE");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || host.endsWith(".") || /(?:^|\.)(localhost|local|internal|lan|home|intranet|invalid|test|onion|arpa)$/.test(host) || /(?:^|\.)example\.(com|net|org)$/.test(host)) fail("SOURCE_HOST_UNSAFE");
  return url;
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Strict subset of global IPv6; reject mapped, link-local, ULA, transition and
  // documentation ranges rather than trying to reach an ambiguous address.
  if (isIP(address) === 6) {
    const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    const parts = normalized.split(":");
    return /^[23]/.test(normalized) && !(parts[0] === "2001" && (parseInt(parts[1] || "0", 16) <= 0x1ff || parts[1] === "db8")) && parts[0] !== "2002" && parts[0] !== "3fff";
  }
  return false;
}

export function validateIngestionConfig(config) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config?.marketId ?? "")) fail("MARKET_ID_INVALID");
  if (!config.location?.city || !/^[A-Z]{2}$/.test(config.location?.state ?? "")) fail("MARKET_LOCATION_REQUIRED");
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone }).format(new Date()); } catch { fail("MARKET_TIMEZONE_INVALID"); }
  if (!config.timeZone) fail("MARKET_TIMEZONE_REQUIRED");
  if (!Array.isArray(config.sources) || !config.sources.length || config.sources.length > INGESTION_LIMITS.maxSources) fail("SOURCE_COUNT_INVALID");
  const ids = new Set(); const urls = new Set();
  for (const source of config.sources) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id ?? "") || ids.has(source.id)) fail("SOURCE_ID_INVALID_OR_DUPLICATE");
    ids.add(source.id);
    const url = validatePublicUrl(source.url);
    if (urls.has(url.href)) fail("SOURCE_URL_DUPLICATE");
    urls.add(url.href);
    if (!["ics", "rss"].includes(source.format) || !source.name || !authorities.has(source.authorityClaim)) fail("SOURCE_CONFIGURATION_INCOMPLETE");
    if (source.format === "rss" && (!/^[a-zA-Z_][\w.-]*(?::[a-zA-Z_][\w.-]*)?$/.test(source.rssEventDateElement ?? "") || ["pubdate", "date", "dc:date"].includes(source.rssEventDateElement.toLowerCase()))) fail("RSS_EXPLICIT_EVENT_DATE_ELEMENT_REQUIRED");
    for (const host of source.allowedEventHosts ?? []) if (validatePublicUrl(`https://${host}/`).hostname !== host) fail("EVENT_HOST_ALLOWLIST_INVALID");
  }
  return config;
}

// Request only the exact URL present in the caller's configured allowlist. Resolve
// all addresses first, reject any private result, then pin the chosen address in
// HTTPS lookup. TLS hostname verification still uses the configured hostname.
export async function fetchConfiguredSource(source, { configuredUrls, resolve = lookup, requestImpl = httpsRequest } = {}) {
  const url = validatePublicUrl(source.url);
  if (!configuredUrls?.includes(url.href)) fail("SOURCE_NOT_EXPLICITLY_ALLOWLISTED");
  let timer; let expired = false; let activeRequest;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; activeRequest?.destroy(); reject(new Error("SOURCE_FETCH_TIMEOUT")); }, INGESTION_LIMITS.timeoutMs); });
  try {
    return await Promise.race([deadline, (async () => {
      const addresses = await resolve(url.hostname, { all: true, verbatim: true });
      if (expired) fail("SOURCE_FETCH_TIMEOUT");
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) fail("SOURCE_DNS_NONPUBLIC");
      const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
      return await new Promise((resolveBody, reject) => {
        const request = requestImpl(url, {
          method: "GET", agent: false, servername: url.hostname,
          headers: { accept: source.format === "ics" ? "text/calendar" : "application/rss+xml, application/xml, text/xml", "accept-encoding": "identity", "user-agent": "LocalOpportunityBrief-source-review/1.0" },
          lookup: (_hostname, options, callback) => options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
        }, (response) => {
          if (response.statusCode !== 200) { response.destroy(); reject(new Error(response.statusCode >= 300 && response.statusCode < 400 ? "SOURCE_REDIRECT_BLOCKED" : `SOURCE_HTTP_${response.statusCode}`)); return; }
          if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new Error("SOURCE_ENCODING_UNSUPPORTED")); return; }
          if (Number(response.headers["content-length"]) > INGESTION_LIMITS.maxBytes) { response.destroy(); reject(new Error("SOURCE_TOO_LARGE")); return; }
          const contentType = String(response.headers["content-type"] ?? "").split(";")[0].toLowerCase();
          const allowedTypes = source.format === "ics" ? ["text/calendar", "application/ics", "text/plain"] : ["application/rss+xml", "application/xml", "text/xml"];
          if (!allowedTypes.includes(contentType)) { response.destroy(); reject(new Error("SOURCE_CONTENT_TYPE_UNSUPPORTED")); return; }
          const chunks = []; let size = 0;
          response.on("data", (chunk) => { size += chunk.length; if (size > INGESTION_LIMITS.maxBytes) { response.destroy(); reject(new Error("SOURCE_TOO_LARGE")); } else chunks.push(chunk); });
          response.on("error", () => reject(new Error("SOURCE_RESPONSE_FAILED")));
          response.on("end", () => {
            try { resolveBody({ text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), bytes: size, contentType, lastModified: response.headers["last-modified"] ?? null }); }
            catch { reject(new Error("SOURCE_TEXT_ENCODING_INVALID")); }
          });
        });
        activeRequest = request;
        request.on("error", () => reject(new Error("SOURCE_REQUEST_FAILED")));
        request.setTimeout(INGESTION_LIMITS.timeoutMs, () => request.destroy(new Error("SOURCE_FETCH_TIMEOUT")));
        request.end();
      });
    })()]);
  } finally { clearTimeout(timer); }
}

function isoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !day(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail("TIMESTAMP_AMBIGUOUS_OR_INVALID");
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) fail("TIMESTAMP_AMBIGUOUS_OR_INVALID"); return date;
}
function wallParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(({ type, value }) => [type, value]));
}
function localToUtc(iso, timeZone) {
  const base = new Date(`${iso}Z`).valueOf(); const offsets = new Set();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const instant = new Date(base + hours * 3_600_000); const p = wallParts(instant, timeZone);
    offsets.add(new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).valueOf() - instant.valueOf());
  }
  const matches = [...offsets].map((offset) => new Date(base - offset)).filter((date) => { const p = wallParts(date, timeZone); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === iso; });
  if (matches.length !== 1) fail("ICS_LOCAL_TIME_AMBIGUOUS_OR_NONEXISTENT");
  return matches[0];
}
function icsDate(property, timeZone, { timestampOnly = false } = {}) {
  if (!property) fail("ICS_DATE_MISSING");
  const value = property.value;
  if (property.params.VALUE === "DATE" && /^\d{8}$/.test(value) && !timestampOnly) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (!day(date) || property.params.TZID) fail("ICS_DATE_INVALID");
    return { date, dateTime: null, allDay: true };
  }
  if (!/^\d{8}T\d{6}Z?$/.test(value) || (property.params.VALUE && property.params.VALUE !== "DATE-TIME")) fail("ICS_DATE_AMBIGUOUS_OR_UNSUPPORTED");
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
  isoTimestamp(`${iso}Z`);
  let date;
  if (value.endsWith("Z") && !property.params.TZID) date = new Date(`${iso}Z`);
  else if (property.params.TZID === timeZone && !timestampOnly) date = localToUtc(iso, timeZone);
  else fail("ICS_FLOATING_OR_UNSUPPORTED_TIMEZONE");
  return { date: localDay(date, timeZone), dateTime: date.toISOString(), allDay: false };
}
const unescapeIcs = (value) => value.replace(/\\([nN,;\\])/g, (_, char) => /n/i.test(char) ? "\n" : char);

export function parseIcs(text, { timeZone }) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(Boolean);
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR" || !lines.includes("VERSION:2.0")) fail("ICS_CALENDAR_UNSUPPORTED");
  if (lines.includes("METHOD:CANCEL")) fail("ICS_CANCELLATION_CALENDAR");
  const events = []; let event = null; const stack = [];
  for (const line of lines) {
    if (line.startsWith("BEGIN:")) { stack.push(line.slice(6)); if (line === "BEGIN:VEVENT") { if (event || stack.length !== 2) fail("ICS_NESTING_INVALID"); event = new Map(); } continue; }
    if (line.startsWith("END:")) { if (stack.pop() !== line.slice(4)) fail("ICS_NESTING_INVALID"); if (line === "END:VEVENT") { events.push(event); event = null; } continue; }
    if (!event || stack.length !== 2) continue;
    const colon = line.indexOf(":"); if (colon < 1) fail("ICS_PROPERTY_INVALID");
    const [name, ...parameters] = line.slice(0, colon).split(";");
    const params = {}; for (const parameter of parameters) { const equals = parameter.indexOf("="); if (equals < 1) fail("ICS_PARAMETER_INVALID"); const key = parameter.slice(0, equals).toUpperCase(); if (params[key]) fail("ICS_PARAMETER_DUPLICATE"); params[key] = parameter.slice(equals + 1).replace(/^"|"$/g, ""); }
    const key = name.toUpperCase(); if (!event.has(key)) event.set(key, []); event.get(key).push({ value: line.slice(colon + 1), params });
  }
  if (stack.length || events.length > INGESTION_LIMITS.maxItems) fail("ICS_STRUCTURE_OR_ITEM_LIMIT_INVALID");
  return events.map((event, index) => {
    try {
      if (event.has("DURATION")) fail("ICS_DURATION_UNSUPPORTED");
      for (const field of ["RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"]) if (event.has(field)) fail("ICS_RECURRENCE_UNSUPPORTED");
      const one = (field) => { const values = event.get(field) ?? []; if (values.length > 1) fail("ICS_DUPLICATE_FIELD"); return values[0]; };
      if (one("STATUS")?.value === "CANCELLED") fail("EVENT_CANCELLED");
      const title = one("SUMMARY")?.value; const url = one("URL")?.value;
      if (!title || !url) fail("EVENT_TITLE_OR_URL_MISSING");
      const start = icsDate(one("DTSTART"), timeZone);
      const end = one("DTEND") ? icsDate(one("DTEND"), timeZone) : null;
      if (end && (start.allDay !== end.allDay || (end.dateTime ?? end.date) <= (start.dateTime ?? start.date))) fail("ICS_END_INVALID");
      const evidence = one("LAST-MODIFIED") ?? one("DTSTAMP");
      const evidenceTimestamp = icsDate(evidence, timeZone, { timestampOnly: true }).dateTime;
      const endDate = end?.allDay ? new Date(new Date(`${end.date}T00:00:00Z`).valueOf() - 86_400_000).toISOString().slice(0, 10) : end?.date ?? null;
      return { index, id: one("UID")?.value ?? null, title: unescapeIcs(title), url, eventDate: start.date, eventDateEnd: endDate, eventDateTime: start.dateTime, allDay: start.allDay, locationText: unescapeIcs(one("LOCATION")?.value ?? ""), evidenceTimestamp, evidenceTimestampKind: one("LAST-MODIFIED") ? "last-modified" : "calendar-dtstamp" };
    } catch (error) { return { index, error: error.message }; }
  });
}

function xmlDecode(text) {
  if (/&(?![^&\s;]+;)/.test(text)) fail("RSS_ENTITY_UNSUPPORTED");
  return text.replace(/&([^;]+);/g, (_, code) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }; if (Object.hasOwn(named, code)) return named[code];
    const point = /^#x[0-9a-f]+$/i.test(code) ? parseInt(code.slice(2), 16) : /^#\d+$/.test(code) ? Number(code.slice(1)) : NaN;
    if (!Number.isInteger(point) || point > 0x10ffff || point < 32 && ![9, 10, 13].includes(point) || point >= 0xd800 && point <= 0xdfff) fail("RSS_ENTITY_UNSUPPORTED");
    return String.fromCodePoint(point);
  });
}
function parseXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("RSS_DTD_OR_ENTITY_FORBIDDEN");
  const root = { name: "root", children: [], text: "" }; const stack = [root];
  const tokens = /<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/gy;
  let token; let position = 0; let nodes = 0;
  while ((token = tokens.exec(text))) {
    if (token.index !== position) fail("RSS_XML_INVALID"); position = tokens.lastIndex; const value = token[0]; const current = stack.at(-1);
    if (value.startsWith("<?") || value.startsWith("<!--")) continue;
    if (value.startsWith("<![CDATA[")) { current.text += value.slice(9, -3); continue; }
    if (value.startsWith("</")) { if (stack.length === 1 || stack.pop().name !== value.slice(2, -1).trim()) fail("RSS_XML_INVALID"); continue; }
    if (value.startsWith("<")) {
      const match = value.match(/^<([\w:.-]+)(?:\s+[\w:.-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*\/?>(?:)$/);
      if (!match || ++nodes > 15_000 || stack.length > 20) fail("RSS_XML_UNSUPPORTED_OR_TOO_COMPLEX");
      const child = { name: match[1], children: [], text: "" }; current.children.push(child); if (!value.endsWith("/>")) stack.push(child); continue;
    }
    current.text += xmlDecode(value);
  }
  if (position !== text.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail("RSS_XML_INVALID");
  return root.children[0];
}
function rssTimestamp(value) {
  if (/^\d{4}-/.test(value)) return isoTimestamp(value);
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} (?:GMT|UTC|[+-]\d{4})$/.test(value)) fail("RSS_PUBLICATION_TIMESTAMP_AMBIGUOUS");
  const parts = value.match(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) /);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(parts[3]) + 1;
  const calendarDate = `${parts[4]}-${String(month).padStart(2, "0")}-${parts[2]}`;
  if (!day(calendarDate) || Number(parts[5]) > 23 || Number(parts[6]) > 59 || Number(parts[7]) > 59 || new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${calendarDate}T00:00:00Z`)) !== parts[1]) fail("RSS_PUBLICATION_TIMESTAMP_INVALID");
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) fail("RSS_PUBLICATION_TIMESTAMP_INVALID"); return date;
}
export function parseRss(text, { timeZone, rssEventDateElement }) {
  const root = parseXml(text); if (root.name !== "rss") fail("RSS_FORMAT_UNSUPPORTED");
  const channels = root.children.filter((node) => node.name === "channel"); if (channels.length !== 1) fail("RSS_CHANNEL_INVALID");
  const items = channels[0].children.filter((node) => node.name === "item"); if (items.length > INGESTION_LIMITS.maxItems) fail("RSS_ITEM_LIMIT_EXCEEDED");
  return items.map((item, index) => {
    try {
      const field = (name) => { const values = item.children.filter((node) => node.name === name); if (values.length > 1 || values[0]?.children.length) fail("RSS_FIELD_AMBIGUOUS"); return values[0]?.text.trim(); };
      if (item.children.some((node) => /(?:^|:)(rrule|recurrence|recurrence-id|rdate|exdate)$/i.test(node.name))) fail("RSS_RECURRENCE_UNSUPPORTED");
      const title = field("title"); const url = field("link"); const eventValue = field(rssEventDateElement);
      if (!title || !url) fail("EVENT_TITLE_OR_URL_MISSING");
      if (!eventValue) fail("RSS_EXPLICIT_EVENT_DATE_MISSING");
      const allDay = day(eventValue); const dateTime = allDay ? null : isoTimestamp(eventValue);
      const evidenceTimestamp = rssTimestamp(field("pubDate") ?? "").toISOString();
      return { index, id: field("guid") ?? null, title, url, eventDate: allDay ? eventValue : localDay(dateTime, timeZone), eventDateEnd: null, eventDateTime: dateTime?.toISOString() ?? null, allDay, locationText: field("ev:location") ?? "", evidenceTimestamp, evidenceTimestampKind: "rss-publication" };
    } catch (error) { return { index, error: error.message }; }
  });
}

export async function ingestConfiguredSources(config, { now = new Date(), fetchSource = fetchConfiguredSource } = {}) {
  validateIngestionConfig(config);
  const asOf = localDay(now, config.timeZone); const configuredUrls = config.sources.map((source) => validatePublicUrl(source.url).href);
  const diagnostics = []; const sourcePacks = []; const receipts = []; const seen = new Set();
  for (const source of config.sources) {
    try {
      const fetched = await fetchSource(source, { configuredUrls });
      if (typeof fetched.text !== "string" || Buffer.byteLength(fetched.text) > INGESTION_LIMITS.maxBytes) fail("SOURCE_TOO_LARGE_OR_MISSING");
      const receipt = { sourceId: source.id, configuredUrl: source.url, fetchedAt: now.toISOString(), bodySha256: hash(fetched.text), bytes: Buffer.byteLength(fetched.text), contentType: fetched.contentType ?? null, lastModified: fetched.lastModified ?? null };
      receipts.push(receipt);
      const events = source.format === "ics" ? parseIcs(fetched.text, config) : parseRss(fetched.text, { ...config, rssEventDateElement: source.rssEventDateElement });
      const candidates = [];
      for (const event of events) {
        try {
          if (event.error) fail(event.error);
          if (event.title.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.title)) fail("EVENT_TITLE_UNSAFE");
          const url = validatePublicUrl(event.url); const allowedHosts = new Set([new URL(source.url).hostname, ...(source.allowedEventHosts ?? [])]);
          if (!allowedHosts.has(url.hostname)) fail("EVENT_URL_NOT_ALLOWLISTED");
          if (days(asOf, event.eventDate) < 0 || days(asOf, event.eventDate) > INGESTION_LIMITS.lookaheadDays) fail("EVENT_OUTSIDE_30_DAY_WINDOW");
          const age = now.valueOf() - new Date(event.evidenceTimestamp).valueOf();
          if (age < -300_000) fail("EVIDENCE_TIMESTAMP_IN_FUTURE");
          if (age > INGESTION_LIMITS.maxEvidenceAgeDays * 86_400_000) fail("EVIDENCE_TIMESTAMP_STALE");
          const duplicateKey = `${url.href}|${event.eventDate}`; if (seen.has(duplicateKey)) fail("DUPLICATE_EVENT_EVIDENCE"); seen.add(duplicateKey);
          candidates.push({ id: `${source.id}-${hash(duplicateKey).slice(0, 16)}`, title: event.title, eventDate: event.eventDate, eventDateEnd: event.eventDateEnd, eventDateTime: event.eventDateTime, allDay: event.allDay, sourceName: source.name, sourceUrl: url.href, sourceFetchedAt: now.toISOString(), sourceCheckedAt: null, sourceAuthority: "unverified", configuredAuthorityClaim: source.authorityClaim, sourceAccessStatus: "pending-owner-validation", marketId: config.marketId, proposedCity: config.location.city, proposedState: config.location.state, locationText: event.locationText, distanceMiles: null, sourcePublishedAt: event.evidenceTimestampKind === "rss-publication" ? event.evidenceTimestamp : null, sourcePublicationStatus: event.evidenceTimestampKind === "rss-publication" ? "displayed" : "not-displayed", evidenceTimestamp: event.evidenceTimestamp, evidenceTimestampKind: event.evidenceTimestampKind, sourceReceipt: receipt, candidateOnly: true, ownerApprovalRequired: true, reviewRequired: ["Verify first-party ownership and event page", "Confirm event date, venue and market geography", "Choose preparation date, customer/product fit, rankings and recommendations", "Complete source validation and authenticated owner market/report review"] });
        } catch (error) { diagnostics.push({ sourceId: source.id, itemIndex: event.index, code: error.message, severity: "blocked-candidate" }); }
      }
      sourcePacks.push({ fixture: false, candidateOnly: true, marketId: config.marketId, sourceNotice: "Unverified feed candidates only. Not usable for report generation or delivery until owner validation.", opportunities: candidates });
      if (!events.length) diagnostics.push({ sourceId: source.id, code: "NO_FEED_EVENTS", severity: "blocked-source" });
    } catch (error) { diagnostics.push({ sourceId: source.id, code: /^[A-Z0-9_]+$/.test(error.message ?? "") ? error.message : "SOURCE_FETCH_OR_PARSE_FAILED", severity: "blocked-source" }); }
  }
  const candidateCount = sourcePacks.reduce((count, pack) => count + pack.opportunities.length, 0);
  return { schemaVersion: 1, status: candidateCount ? "PENDING_OWNER_SOURCE_VALIDATION" : "BLOCKED", marketId: config.marketId, asOf, generatedAt: now.toISOString(), candidateOnly: true, ownerApprovalRequired: true, liveDelivery: false, candidateCount, sourcePacks, receipts, diagnostics };
}
