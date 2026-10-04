import { createHash } from "node:crypto";

export const LOOKAHEAD_DAYS = 30;
export const MAX_SOURCE_AGE_DAYS = 14;
export const APPROVED_SOURCE_AUTHORITIES = new Set([
  "official-government",
  "official-school",
  "official-organizer",
  "official-destination-office",
  "customer-first-party",
]);

const guaranteedPhrases = [
  "guaranteed sales",
  "guaranteed revenue",
  "guaranteed traffic",
  "will make you",
  "risk-free profit",
];

function intersectionCount(left, right) {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.filter((item) => rightSet.has(item.toLowerCase())).length;
}

export function scoreOpportunity(customer, opportunity, asOf) {
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const eventDate = new Date(`${opportunity.eventDate}T00:00:00Z`);
  const daysAway = Math.ceil((eventDate - asOfDate) / 86_400_000);

  if (daysAway < 0 || daysAway > LOOKAHEAD_DAYS) {
    return { eligible: false, score: 0 };
  }
  const sameCity = opportunity.city?.toLowerCase() === customer.location.city.toLowerCase() && opportunity.state?.toLowerCase() === customer.location.state.toLowerCase();
  const cityMatchOnly = opportunity.geographyMode === "city_match" && sameCity;
  if (!cityMatchOnly && (!Number.isFinite(opportunity.distanceMiles) || opportunity.distanceMiles < 0 || opportunity.distanceMiles > customer.location.radiusMiles)) {
    return { eligible: false, score: 0 };
  }

  // Distances in a reusable source pack are only meaningful for its named market.
  const expectedMarket = customer.marketId;
  if (expectedMarket && opportunity.marketId !== expectedMarket) return { eligible: false, score: 0 };
  if (!expectedMarket && (opportunity.city?.toLowerCase() !== customer.location.city.toLowerCase() || opportunity.state?.toLowerCase() !== customer.location.state.toLowerCase())) return { eligible: false, score: 0 };
  const prepareBy = new Date(`${opportunity.prepareBy}T00:00:00Z`);
  if (!Number.isFinite(eventDate.valueOf()) || !Number.isFinite(prepareBy.valueOf()) || prepareBy < asOfDate || prepareBy > eventDate) return { eligible: false, score: 0 };

  const excluded = customer.exclusions.some((excludedTerm) =>
    JSON.stringify(opportunity).toLowerCase().includes(excludedTerm.toLowerCase()),
  );
  if (excluded) return { eligible: false, score: 0 };

  const customerMatch = intersectionCount(
    opportunity.customerTags,
    customer.customers,
  );
  const productMatch = intersectionCount(
    opportunity.productTags,
    customer.products,
  );
  if (customerMatch === 0 && productMatch === 0) {
    return { eligible: false, score: 0 };
  }

  const distanceScore = cityMatchOnly ? 10 : Math.max(
    0,
    20 - (opportunity.distanceMiles / customer.location.radiusMiles) * 20,
  );
  const timingScore = daysAway <= 14 ? 18 : 15;
  const score = Math.round(
    distanceScore +
      timingScore +
      opportunity.sourceQuality * 5 +
      opportunity.urgency * 4 +
      opportunity.preparationEase * 2 +
      Math.min(customerMatch * 4, 8) +
      Math.min(productMatch * 5, 10),
  );

  return { eligible: true, score: Math.min(score, 100), daysAway };
}

function productExamples(customer, opportunity) {
  const matching = customer.products.filter((product) =>
    opportunity.productTags
      .map((item) => item.toLowerCase())
      .includes(product.toLowerCase()),
  );
  return (matching.length ? matching : customer.products.slice(0, 2)).join(
    " and ",
  );
}

export function buildRecommendation(customer, opportunity, score, daysAway) {
  const products = productExamples(customer, opportunity);
  return {
    id: opportunity.id,
    title: opportunity.title,
    score,
    daysAway,
    eventDate: opportunity.eventDate,
    eventDateEnd: opportunity.eventDateEnd ?? null,
    eventTime: opportunity.eventTime ?? null,
    venue: opportunity.venue ?? null,
    riskWarnings: opportunity.riskWarnings ?? [],
    geographyBasis: opportunity.geographyBasis ?? null,
    prepareBy: opportunity.prepareBy,
    location: `${opportunity.city}, ${opportunity.state}`,
    distanceMiles: opportunity.geographyMode === "city_match" ? null : opportunity.distanceMiles,
    geographyMode: opportunity.geographyMode ?? "distance",
    marketId: opportunity.marketId ?? customer.marketId ?? null,
    why: `${opportunity.title} matches ${customer.businessName}'s local audience and listed product categories, including ${products}.`,
    offer: `Build a focused ${opportunity.offerType} using product categories listed in the business profile; confirm available stock first.`,
    firstAction: `Choose 4–6 in-stock examples from ${products}, confirm quantities, and take one clear group photograph.`,
    caption: `${opportunity.title} is coming up in ${customer.location.city}. We gathered a few easy, thoughtful favorites for the occasion—available while current stock lasts.`,
    emailSubject: `${opportunity.title}: a simple local shopping idea`,
    emailBody:
      "A timely local moment is coming up. We prepared a small edit from our current inventory to make shopping easier. Stop in and take a look before the event.",
    guidance: `Use a ${customer.voice.join(", ")} tone and keep the message specific to ${customer.location.city}.`,
    ...Object.fromEntries(Object.entries(opportunity.recommendation ?? {}).filter(([key, value]) => ["why", "offer", "firstAction", "caption", "emailSubject", "emailBody", "guidance"].includes(key) && typeof value === "string")),
    evidence: {
      sourceName: opportunity.sourceName,
      sourceUrl: opportunity.sourceUrl,
      checkedAt: opportunity.sourceCheckedAt,
      authority: opportunity.sourceAuthority,
      accessStatus: opportunity.sourceAccessStatus,
      evidenceNotes: opportunity.evidenceNotes ?? "",
      publishedAt: opportunity.sourcePublishedAt ?? null,
      publicationStatus: opportunity.sourcePublicationStatus ?? "not-displayed",
      confidence:
        opportunity.sourceQuality >= 5
          ? "high"
          : opportunity.sourceQuality >= 3
            ? "medium"
            : "low",
    },
  };
}

export function generateReport(customer, opportunities, options) {
  const asOf = options.asOf;
  const seenEvents = new Set();
  const ranked = opportunities
    .map((opportunity) => ({
      opportunity,
      result: scoreOpportunity(customer, opportunity, asOf),
    }))
    .filter(({ result }) => result.eligible)
    .sort(
      (left, right) =>
        right.result.score - left.result.score ||
        left.opportunity.eventDate.localeCompare(right.opportunity.eventDate),
    )
    .filter(({ opportunity }) => {
      const key = `${opportunity.sourceUrl}|${opportunity.eventDate}|${opportunity.city?.toLowerCase()}`;
      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    })
    .slice(0, 5)
    .map(({ opportunity, result }) =>
      buildRecommendation(
        customer,
        opportunity,
        result.score,
        result.daysAway,
      ),
    );

  const deliveryMode = customer.deliveryMode ?? "owner_review_only";

  const report = {
    schemaVersion: 1,
    reportId: `${customer.slug}-${asOf}`,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    asOf,
    weekOf: asOf,
    customer: {
      slug: customer.slug,
      businessName: customer.businessName,
      deliveryEmail: customer.deliveryEmail,
      location: customer.location,
      category: customer.category,
      deliveryMode,
      marketId: customer.marketId ?? null,
    },
    fixture: Boolean(options.fixture),
    status: "PENDING_APPROVAL",
    lookaheadDays: LOOKAHEAD_DAYS,
    deliveryEligible: deliveryMode === "customer" && !Boolean(options.fixture),
    summary: `This week's strongest opportunities emphasize timely local activity, listed products, and actions ${customer.businessName} can prepare without account access or unverified discounts.`,
    opportunities: ranked,
    safeguards: {
      guaranteedResults: false,
      customerAccountAccess: false,
      automaticPosting: false,
      liveDelivery: false,
      ownerApprovalRequired: true,
    },
  };

  report.checksum = computeReportChecksum(report);
  return report;
}

export function computeReportChecksum(report) {
  const checksumPayload = { ...report };
  delete checksumPayload.checksum;
  return createHash("sha256")
    .update(JSON.stringify(checksumPayload))
    .digest("hex");
}

export function validateReport(report) {
  const errors = [];
  const warnings = [];
  const asOfDate = parseDate(report.asOf);

  if (!asOfDate) {
    errors.push("Report as-of date must use YYYY-MM-DD.");
  }
  if (report.lookaheadDays !== LOOKAHEAD_DAYS) {
    errors.push(`Report lookahead must be exactly ${LOOKAHEAD_DAYS} days.`);
  }

  if (report.opportunities.length !== 5) {
    errors.push(
      `Expected exactly 5 opportunities; found ${report.opportunities.length}.`,
    );
  }

  const ids = new Set();
  const evidenceKeys = new Set();
  for (const opportunity of report.opportunities) {
    if (ids.has(opportunity.id)) {
      errors.push(`Duplicate opportunity: ${opportunity.id}`);
    }
    ids.add(opportunity.id);
    const evidenceKey = `${opportunity.evidence.sourceUrl}|${opportunity.eventDate}|${opportunity.location}`;
    if (evidenceKeys.has(evidenceKey)) errors.push(`Duplicate event evidence: ${opportunity.id}`);
    evidenceKeys.add(evidenceKey);

    const cityMatchOnly = opportunity.geographyMode === "city_match" && opportunity.location === `${report.customer.location.city}, ${report.customer.location.state}`;
    if (!cityMatchOnly && (!Number.isFinite(opportunity.distanceMiles) || opportunity.distanceMiles < 0 || opportunity.distanceMiles > report.customer.location.radiusMiles)) {
      errors.push(`Outside verified customer radius: ${opportunity.id}`);
    }
    if (report.customer.marketId && opportunity.marketId !== report.customer.marketId) {
      errors.push(`Opportunity belongs to another market: ${opportunity.id}`);
    }
    if (!report.customer.marketId && opportunity.location !== `${report.customer.location.city}, ${report.customer.location.state}`) {
      errors.push(`Opportunity has no matching geographic proof: ${opportunity.id}`);
    }
    const eventDate = parseDate(opportunity.eventDate);
    const prepareBy = parseDate(opportunity.prepareBy);
    const checkedAt = parseDate(opportunity.evidence.checkedAt);
    if (!eventDate) {
      errors.push(`Invalid event date: ${opportunity.id}`);
    } else if (asOfDate) {
      const daysAway = dayDifference(asOfDate, eventDate);
      if (daysAway < 0) errors.push(`Past event date: ${opportunity.id}`);
      if (daysAway > LOOKAHEAD_DAYS) {
        errors.push(
          `Event outside the ${LOOKAHEAD_DAYS}-day promise: ${opportunity.id}`,
        );
      }
    }
    if (!prepareBy) {
      errors.push(`Invalid prepare-by date: ${opportunity.id}`);
    } else if (eventDate && prepareBy > eventDate) {
      errors.push(`Prepare-by date is after the event: ${opportunity.id}`);
    } else if (asOfDate && prepareBy < asOfDate) {
      errors.push(`Prepare-by date is already past: ${opportunity.id}`);
    }
    if (!isHttpsUrl(opportunity.evidence.sourceUrl)) {
      errors.push(`Non-HTTPS evidence URL: ${opportunity.id}`);
    }
    if (!checkedAt) {
      errors.push(`Invalid source-check date: ${opportunity.id}`);
    } else if (asOfDate) {
      const sourceAge = dayDifference(checkedAt, asOfDate);
      if (sourceAge < 0) {
        errors.push(`Source check is dated in the future: ${opportunity.id}`);
      } else if (sourceAge > MAX_SOURCE_AGE_DAYS) {
        errors.push(`Stale source check: ${opportunity.id}`);
      }
    }
    if (!report.fixture) {
      if (isPlaceholderUrl(opportunity.evidence.sourceUrl)) {
        errors.push(`Placeholder evidence URL: ${opportunity.id}`);
      }
      if (!APPROVED_SOURCE_AUTHORITIES.has(opportunity.evidence.authority)) {
        errors.push(`Unapproved source authority: ${opportunity.id}`);
      }
      if (opportunity.evidence.accessStatus !== "verified") {
        errors.push(`Source access was not verified: ${opportunity.id}`);
      }
    }
    if (!["high", "medium"].includes(opportunity.evidence.confidence)) {
      warnings.push(`Low-confidence evidence: ${opportunity.id}`);
    }
    const wording = JSON.stringify(opportunity).toLowerCase();
    for (const phrase of guaranteedPhrases) {
      if (wording.includes(phrase)) {
        errors.push(
          `Prohibited guarantee phrase "${phrase}" in ${opportunity.id}`,
        );
      }
    }
  }

  if (report.status !== "PENDING_APPROVAL") {
    errors.push("A newly generated report must stop at PENDING_APPROVAL.");
  }
  if (report.safeguards.liveDelivery !== false) {
    errors.push("A generated report cannot enable live delivery.");
  }
  const expectedDeliveryEligibility =
    report.customer.deliveryMode === "customer" && !report.fixture;
  if (report.deliveryEligible !== expectedDeliveryEligibility) {
    errors.push("Report delivery eligibility does not match the customer mode.");
  }
  if (report.checksum !== computeReportChecksum(report)) {
    errors.push("Report checksum does not match the report contents.");
  }
  if (report.fixture) {
    warnings.push(
      "Fixture data: demonstration only; live delivery is prohibited.",
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

export function renderMarkdown(report, validation, { deliveryPresentation = null } = {}) {
  const lines = [
    `# Local Opportunity Brief — ${report.customer.businessName}`,
    "",
    `**Week of:** ${report.weekOf}`,
    `**Location:** ${report.customer.location.city}, ${report.customer.location.state}`,
    ...(deliveryPresentation ? [
      `**Source snapshot date:** ${report.asOf}`,
      `**Snapshot generated:** ${report.generatedAt}`,
      `**Email prepared:** ${deliveryPresentation.preparedAt}`,
      `**Review:** ${deliveryPresentation.reviewSummary}`,
    ] : [`**Status:** ${report.status}`]),
    `**Research window:** ${report.lookaheadDays} days`,
    `**Delivery mode:** ${report.customer.deliveryMode}`,
    `**Validation:** ${validation.passed ? "PASS" : "FAIL"}`,
    `**${deliveryPresentation ? "Report content checksum" : "Checksum"}:** \`${report.checksum}\``,
    "",
    report.fixture
      ? "> DEMONSTRATION DATA ONLY — DO NOT DELIVER AS LIVE RESEARCH."
      : "",
    "",
    "## This week's direction",
    "",
    report.summary,
    "",
  ];

  for (const [index, opportunity] of report.opportunities.entries()) {
    lines.push(
      `## ${index + 1}. ${opportunity.title}`,
      "",
      `- **Fit score:** ${opportunity.score}/100`,
      `- **Event date:** ${opportunity.eventDate}`,
      `- **Prepare by:** ${opportunity.prepareBy}`,
      ...(opportunity.eventTime ? [`- **Event time:** ${opportunity.eventTime}`] : []),
      ...(opportunity.venue ? [`- **Venue:** ${opportunity.venue}`] : []),
      ...(opportunity.riskWarnings ?? []).map((warning) => `- **Check before use:** ${warning}`),
      `- **Location:** ${opportunity.location}`,
      ...(opportunity.geographyBasis ? [`- **Geography evidence:** ${opportunity.geographyBasis}`] : []),
      `- **Why it fits:** ${opportunity.why}`,
      `- **Recommended offer:** ${opportunity.offer}`,
      `- **Do this first:** ${opportunity.firstAction}`,
      "",
      "### Ready-to-use caption",
      "",
      opportunity.caption,
      "",
      "### Customer email",
      "",
      `**Subject:** ${opportunity.emailSubject}`,
      "",
      opportunity.emailBody,
      "",
      `**Evidence:** [${opportunity.evidence.sourceName}](${opportunity.evidence.sourceUrl}) · checked ${opportunity.evidence.checkedAt} · ${opportunity.evidence.confidence} confidence`,
      ...(opportunity.evidence.evidenceNotes ? [opportunity.evidence.evidenceNotes] : []),
      "",
    );
  }

  lines.push(
    "## Safeguards",
    "",
    "- No guaranteed sales claims",
    "- No customer account access",
    "- No automatic posting",
    deliveryPresentation
      ? report.customer.deliveryMode === "owner_review_only"
        ? "- Owner-only rehearsal; no customer delivery is authorized"
        : "- Future deliveries remain subject to subscription, consent and review controls"
      : "- Live delivery remains disabled until owner approval",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function dayDifference(left, right) {
  return Math.round((right.valueOf() - left.valueOf()) / 86_400_000);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      ["example.com", "example.net", "example.org"].includes(hostname) ||
      hostname.endsWith(".example.com") ||
      hostname.endsWith(".example.net") ||
      hostname.endsWith(".example.org") ||
      hostname.endsWith(".invalid") ||
      hostname === "localhost"
    );
  } catch {
    return true;
  }
}

