# Weekly Operating Procedure

## Monday report cycle

1. Load each active customer profile.
2. Load approved, current opportunity records for that customer's location.
3. Remove expired, duplicate, excluded, unsupported, and out-of-area findings.
4. Score remaining findings for source quality, distance, urgency, customer fit,
   product fit, and preparation time.
5. Select the five highest-scoring findings.
6. Generate a customer-specific recommended offer, first action, caption, and
   evidence line for each finding.
7. Run the complete validation gate.
8. Produce Markdown, JSON, email-preview, and approval-record files.
9. Stop at `PENDING` for owner review.
10. Deliver only after the approval record says `APPROVED` and live delivery is
    explicitly enabled.
11. Save the delivery receipt or failure record.

## Customer onboarding

1. Receive the founding membership request.
2. Verify the business exists and fits the supported category.
3. Confirm enough official local sources exist.
4. Confirm the business's products, customers, voice, radius, and exclusions.
5. Create the customer profile in `automation/customers/`.
6. Run a sample report in dry-run mode.
7. Review the sample for relevance.
8. Send checkout only after the service can fulfill the promise.
9. Mark the profile active only after payment confirmation.

## Cancellation

1. Confirm the cancellation request.
2. Mark the customer inactive before the next report cycle.
3. Stop future delivery.
4. Preserve only the records required by the retention policy.
5. Do not issue a refund without a separate owner decision.
