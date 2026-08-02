# Launch Gate

The business is not approved for public launch until every item passes.

Checked items below are verified in the repository. Unchecked items require a
real provider test, owner configuration, outside review, or customer evidence.

## Product

- [ ] Five live reports contain no invented facts.
- [ ] Every factual claim has an accessible original source.
- [ ] Dates, locations, and business names are correct.
- [ ] At least four of five opportunities are rated useful by test businesses.
- [ ] Owner review averages under ten minutes per report.

## Customer

- [ ] At least three independent retailers review a sample.
- [ ] At least one retailer agrees to pay $49.
- [ ] Cancellation and refund wording is visible.
- [ ] No testimonial is published without written permission.

## Operations

- [ ] Owner email is configured.
- [ ] The outbound-delivery approval environment is configured in GitHub.
- [ ] Email delivery is tested with an owner-only address.
- [ ] Payment checkout is tested in provider test mode.
- [x] Payment webhook signature validation passes in automated tests and rejects live-mode payloads.
- [x] Failed deliveries create a diagnostic packet and a deduplicated GitHub owner alert.
- [x] Duplicate delivery protection passes with both an atomic local claim and provider idempotency key.

## Business

- [ ] Legal business and tax setup are reviewed for the owner's location.
- [ ] Privacy policy and terms are reviewed before public collection.
- [ ] Domain purchase receives separate owner approval.
- [ ] Public deployment receives separate owner approval.
- [ ] No paid service is activated without owner approval.
