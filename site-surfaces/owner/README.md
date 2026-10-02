# Existing private owner Site surface

Canonical source overlay for existing Site `local-opportunity-owner`, project `appgprj_6a8a1c97eb8c8191a3651171296ca2ff`. Preserve its lockfile/build setup and private access. No new Site or database is created.

The page authenticates Michelle before reading `/api/internal/operations` on the existing customer Site. It uses the existing server-side REPORT_SYNC_SECRET only for read access. It does not grant report approval to automation. Decisions link to the customer service's authenticated `/dashboard` where owner identity is checked again. The shared secret is never returned to a browser or stored in this repository.

Unavailable data produces an explicit connection warning. MRR stays unverified without provider evidence. Do not describe this read-only surface as implementing approval buttons itself. The customer Site must allow the authenticated API request through its platform access boundary; no bypass token is embedded.
