# Owner-only synthetic intake testing

The authenticated owner uses `/dashboard/qa-intake`. This submits ordinary business/location fields through the same validator and storage pipeline as public intake, but explicitly acknowledges a synthetic QA run. It does not accept service terms, record privacy acceptance, create a purchase, or authorize customer email.

The server, not a submitted flag, selects QA mode after matching authenticated platform identity to OWNER_EMAIL. The record must use the configured owner email. Public intake rejects QA flags. QA IDs have a `qa-` prefix outside public IDs, separate market IDs, `test_qa` payment status, `test` customer status, false legal/delivery consents, and no checkout capability. Duplicate QA submissions preserve the original record and verify test classification.

QA records are shown separately from business customer counts. Checkout, active-customer export and customer delivery reject QA records. Any owner-only report delivery remains subject to exact report approval and provider verification; intake QA itself sends nothing. Real public intake still requires the customer's own legal acknowledgments.
