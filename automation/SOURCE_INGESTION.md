# Configured first-party feed ingestion

This is a Node-only candidate extractor for explicitly configured ICS and RSS 2.0
feeds. It does not discover sources for arbitrary cities, scrape search results,
assert first-party ownership, invent event dates or unlock customer delivery.

## Run it

Create a private market-ingestion JSON file with this shape. The placeholder URL
below is intentionally invalid and must be replaced with an owner-selected,
public HTTPS first-party feed before the command can run:

```json
{
  "marketId": "city-st",
  "location": { "city": "City", "state": "ST" },
  "timeZone": "America/Chicago",
  "sources": [
    {
      "id": "city-calendar",
      "name": "City official calendar",
      "format": "ics",
      "url": "https://replace-with-official-domain.invalid/calendar.ics",
      "authorityClaim": "official-government",
      "allowedEventHosts": []
    }
  ]
}
```

For RSS, use `"format": "rss"` and add `"rssEventDateElement": "ev:startdate"`
or the actual explicit event-start element used by that feed. The standard RSS
`pubDate` describes publication; it is never treated as the event date. Event
links must stay on the configured feed hostname unless their exact hostnames are
also configured in `allowedEventHosts`. No event links are fetched.

```sh
mkdir -p automation/outbox
node automation/ingest-sources.mjs --config /private/market-ingestion.json --out-dir automation/outbox/new-market-source-review
```

The output directory must be new. Existing evidence is never overwritten. The
command writes `registry-candidates.json` and `ingestion-diagnostics.json`. A run
with no accepted candidates exits nonzero. Partial results retain explicit
per-source and per-item blocked diagnostics; they are not a complete report.

## Supported and rejected formats

- ICS: one-off VEVENT records in VCALENDAR 2.0, unfolded lines, explicit all-day
  DATE values, UTC timestamps, and timestamps in the market's configured IANA
  timezone. UTC dates are converted to the market's local day. All-day DTEND is
  exclusive and is represented accordingly
- ICS rejects recurrence rules/dates/exclusions/overrides, duration-only events,
  cancellations, floating timestamps, foreign/custom timezones, duplicate key
  fields, invalid dates, and ambiguous/nonexistent local times at DST transitions
- ICS requires LAST-MODIFIED or DTSTAMP evidence. A calendar timestamp is labeled
  as metadata and is not presented as a publication date
- RSS 2.0: simple item title/link, an explicitly configured event-start field
  containing ISO date or ISO timestamp with timezone, and an explicit publication
  timestamp. Publication accepts strict ISO timestamp or weekday-prefixed RFC 822
  date with numeric offset/GMT/UTC. Ambiguous dates are rejected
- RSS rejects DTDs/entities, XML external entities, unsupported nested selected
  fields, malformed XML, recurrence markers and missing event or publication dates
- Evidence older than 14 days or more than five minutes in the future is blocked.
  Only event starts within the next 30 local days are candidates. Recurring or
  already-running events require separate manual research rather than expansion

These conservative limitations may exclude legitimate feeds. A blocked feed
needs an explicit adapter or manual source review; do not mark it verified merely
to bypass a diagnostic.

## Network boundaries

The configured URLs themselves are the fetch allowlist. HTTPS only; no embedded
credentials, fragments, nonstandard ports, IP literals, internal/localhost names
or redirects. All DNS answers must be public. The selected public address is
pinned into the HTTPS connection lookup while TLS still verifies the source
hostname, preventing a second DNS resolution from rebinding to an internal host.
IPv6 support deliberately excludes transition and special-purpose ranges.

Requests send no cookies or authorization. They are limited to 15 seconds
including DNS, 1 MB of uncompressed UTF-8 text, 10 sources, 500 items per feed and
bounded XML depth/node count. Compression and incompatible content types are
rejected. HTTP error/redirect streams are closed without following or draining
them. No paid tools or provider credentials are involved.

## Owner review and market importer

Output reuses the existing `{ marketId, sourcePacks }` registry envelope, with
`candidateOnly: true` and `ownerApprovalRequired: true`. Every candidate keeps
`sourceAuthority: "unverified"`, `sourceAccessStatus: "pending-owner-validation"`
and `sourceCheckedAt: null`. The configured first-party authority is only a claim.
Source receipts preserve exact fetch time, response byte count, content type and
SHA-256 of the fetched text.

The existing `/api/internal/markets` importer intentionally rejects these raw
candidates. Human review must establish first-party ownership, current event
facts, venue/geographic fit, appropriate preparation date, customer/product tags,
rankings and recommendations in a separate reviewed source pack. Do not supply
made-up values to make validation pass. Validate the reviewed pack through
`validateSourcePack` before an authorized market import. Import still leaves the
market pending authenticated owner review; it is not a report-delivery approval.

This CLI has no import, approval, checkout or email action and never fills a
five-opportunity quota by invention. No configured live feed has been fetched as
part of its synthetic regression tests. Live feed coverage must be verified
separately for each new market.

## Related report recovery

`IMMUTABLE_PACKET_INCOMPLETE` fails closed after an interrupted report write.
Repair must reconstruct only missing artifacts from the exact previously frozen
report/source evidence, preserve the report checksum, and leave all existing
owner approvals, provider receipts and uncertain-send locks intact. Never delete
or regenerate approved content merely to make a run green.

## References

- [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545): DATE, DATE-TIME,
  timezone, recurrence and exclusive DTEND semantics
- [RSS 2.0 specification](https://www.rssboard.org/rss-specification): publication
  date and extensible item elements

Run `node --test automation/tests/source-ingestion.test.mjs` for synthetic
parser, network-boundary, freshness and approval-gate regression coverage.
