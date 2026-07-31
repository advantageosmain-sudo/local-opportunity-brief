import { createHash } from "node:crypto";

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

  if (daysAway < 0 || daysAway > 90) return { eligible: false, score: 0 };
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
  const timingScore =
    daysAway <= 14 ? 18 : daysAway <= 30 ? 15 : daysAway <= 60 ? 10 : 5;
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

export function buildRecommendation(customer, opportunity, score) {
  const products = productExamples(customer, opportunity);
  return {
    id: opportunity.id,
    title: opportunity.title,
    score,
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
      buildRecommendation(customer, opportunity, result.score),
    );

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
    },
    fixture: Boolean(options.fixture),
    status: "PENDING_APPROVAL",
    summary: `This week's strongest opportunities emphasize timely local activity, confirmed products, and actions ${customer.businessName} can prepare without account access or unverified discounts.`,
    opportunities: ranked,
    safeguards: {
      guaranteedResults: false,
      customerAccountAccess: false,
      automaticPosting: false,
      liveDelivery: false,
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
  const asOfDate = new Date(`${report.asOf}T00:00:00Z`);

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

    if (new Date(`${opportunity.eventDate}T00:00:00Z`) < asOfDate) {
      errors.push(`Past event date: ${opportunity.id}`);
    }
    if (!/^https:\/\//.test(opportunity.evidence.sourceUrl)) {
      errors.push(`Non-HTTPS evidence URL: ${opportunity.id}`);
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
