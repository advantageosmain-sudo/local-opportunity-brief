import { createHash } from "node:crypto";

export const LOOKAHEAD_DAYS = 30;
export const MAX_SOURCE_AGE_DAYS = 14;
export const APPROVED_SOURCE_AUTHORITIES = new Set([
  "official-government",
  "official-school",
  "official-organizer",
  "official-destination-office",
  "customer-first-party",
  "reputable-local-reporting",
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
  if (opportunity.distanceMiles > customer.location.radiusMiles) {
    return { eligible: false, score: 0 };
  }

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

  const distanceScore = Math.max(
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
    prepareBy: opportunity.prepareBy,
    location: `${opportunity.city}, ${opportunity.state}`,
    why: `${opportunity.title} matches ${customer.businessName}'s local audience and confirmed inventory categories, including ${products}.`,
    offer: `Build a focused ${opportunity.offerType} using products already confirmed in the business profile.`,
    firstAction: `Choose 4–6 in-stock examples from ${products}, confirm quantities, and take one clear group photograph.`,
    caption: `${opportunity.title} is coming up in ${customer.location.city}. We gathered a few easy, thoughtful favorites for the occasion—available while current stock lasts.`,
    emailSubject: `${opportunity.title}: a simple local shopping idea`,
    emailBody:
      "A timely local moment is coming up. We prepared a small edit from our current inventory to make shopping easier. Stop in and take a look before the event.",
    guidance: `Use a ${customer.voice.join(", ")} tone and keep the message specific to ${customer.location.city}.`,
    evidence: {
      sourceName: opportunity.sourceName,
      sourceUrl: opportunity.sourceUrl,
      checkedAt: opportunity.sourceCheckedAt,
      authority: opportunity.sourceAuthority,
      accessStatus: opportunity.sourceAccessStatus,
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
    generatedAt: `${asOf}T12:00:00.000Z`,
    asOf,
    weekOf: asOf,
    customer: {
      slug: customer.slug,
      businessName: customer.businessName,
      deliveryEmail: customer.deliveryEmail,
      location: customer.location,
      category: customer.category,
      deliveryMode,
    },
    fixture: Boolean(options.fixture),
    status: "PENDING_APPROVAL",
    lookaheadDays: LOOKAHEAD_DAYS,
    deliveryEligible: deliveryMode === "customer" && !Boolean(options.fixture),
    summary: `This week's strongest opportunities emphasize timely local activity, confirmed products, and actions ${customer.businessName} can prepare without account access or unverified discounts.`,
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
  for (const opportunity of report.opportunities) {
    if (ids.has(opportunity.id)) {
      errors.push(`Duplicate opportunity: ${opportunity.id}`);
    }
    ids.add(opportunity.id);

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

export function renderMarkdown(report, validation) {
  const lines = [
    `# Local Opportunity Brief — ${report.customer.businessName}`,
    "",
    `**Week of:** ${report.weekOf}`,
    `**Location:** ${report.customer.location.city}, ${report.customer.location.state}`,
    `**Status:** ${report.status}`,
    `**Research window:** ${report.lookaheadDays} days`,
    `**Delivery mode:** ${report.customer.deliveryMode}`,
    `**Validation:** ${validation.passed ? "PASS" : "FAIL"}`,
    `**Checksum:** \`${report.checksum}\``,
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
      `- **Location:** ${opportunity.location}`,
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
      "",
    );
  }

  lines.push(
    "## Safeguards",
    "",
    "- No guaranteed sales claims",
    "- No customer account access",
    "- No automatic posting",
    "- Live delivery remains disabled until owner approval",
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
