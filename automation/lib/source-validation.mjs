import { isDeliverableEmail } from "./customer-policy.mjs";
import {
  APPROVED_SOURCE_AUTHORITIES,
  MAX_SOURCE_AGE_DAYS,
} from "./engine.mjs";

const CUSTOMER_STATUSES = new Set(["active", "pilot", "demo", "inactive", "paused", "canceled", "cancelled", "unpaid"]);
const DELIVERY_MODES = new Set(["customer", "owner_review_only"]);

export function validateCustomerProfile(customer) {
  const errors = [];
  const warnings = [];

  if (!customer || typeof customer !== "object") {
    return { passed: false, errors: ["Customer profile must be an object."], warnings };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customer.slug ?? "")) {
    errors.push("Customer slug is missing or unsafe.");
  }
  if (!CUSTOMER_STATUSES.has(customer.status)) {
    errors.push("Customer status is not supported.");
  }
  if (!DELIVERY_MODES.has(customer.deliveryMode ?? "owner_review_only")) {
    errors.push("Customer delivery mode is not supported.");
  }
  if (!customer.businessName || !customer.location?.city || !customer.location?.state) {
    errors.push("Customer business name, city, and state are required.");
  }
  if (customer.deliveryMode === "customer" && !isDeliverableEmail(customer.deliveryEmail)) {
    errors.push("Customer delivery email is missing or unsafe.");
  }
  if (!Number.isFinite(customer.location?.radiusMiles) || customer.location.radiusMiles <= 0) {
    errors.push("Customer radius must be a positive number.");
  }
  for (const field of ["products", "customers", "voice", "exclusions"]) {
    if (!Array.isArray(customer[field])) errors.push(`Customer ${field} must be a list.`);
  }
  if (!Array.isArray(customer.approvedSourceFiles) && !customer.marketProfileFile) errors.push("Customer must name approved source files or a market profile.");
  if (customer.deliveryMode !== "customer") {
    warnings.push("Owner-review-only customer: live delivery is prohibited.");
  }

  return { passed: errors.length === 0, errors, warnings };
}

export function validateSourcePack(source, { asOf }) {
  const errors = [];
  const warnings = [];
  // Fixed codes preserve concurrent defects without parsing messages or IDs.
  const codes = new Set();
  const fail = (code, message) => { codes.add(code); errors.push(message); };
  const ids = new Set();

  if (!source || typeof source !== "object") {
    return { passed: false, errors: ["Source pack must be an object."], warnings, codes: ['SOURCE_REGISTRY_INVALID'] };
  }
  if (typeof source.fixture !== "boolean") {
    fail('SOURCE_VERIFICATION_REQUIRED', "Source pack must explicitly declare fixture true or false.");
  }
  if (!Array.isArray(source.opportunities) || source.opportunities.length === 0) {
    fail('SOURCE_REGISTRY_INVALID', "Source pack must contain at least one opportunity.");
  }

  for (const opportunity of source.opportunities ?? []) {
    const id = opportunity.id ?? "unknown";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      fail('SOURCE_ID_INVALID', `Unsafe opportunity id: ${id}`);
    }
    if (ids.has(id)) fail('SOURCE_ID_DUPLICATE', `Duplicate source opportunity: ${id}`);
    ids.add(id);

    for (const field of ["title", "eventDate", "prepareBy", "city", "state", "sourceName", "sourceUrl", "sourceCheckedAt", "offerType"]) {
      if (!opportunity[field]) fail('SOURCE_FIELDS_MISSING', `Missing ${field}: ${id}`);
    }
    for (const field of ["customerTags", "productTags"]) {
      if (!Array.isArray(opportunity[field]) || opportunity[field].length === 0) {
        fail('SOURCE_FIELDS_MISSING', `Missing ${field}: ${id}`);
      }
    }
    if (opportunity.geographyMode !== "city_match" && (!Number.isFinite(opportunity.distanceMiles) || opportunity.distanceMiles < 0)) {
      fail('SOURCE_DISTANCE_INVALID', `Invalid distance: ${id}`);
    }
    if (!Number.isInteger(opportunity.sourceQuality) || opportunity.sourceQuality < 1 || opportunity.sourceQuality > 5) {
      fail('SOURCE_QUALITY_INVALID', `Invalid source quality: ${id}`);
    }
    for (const field of ["urgency", "preparationEase"]) {
      if (!Number.isInteger(opportunity[field]) || opportunity[field] < 1 || opportunity[field] > 5) fail('SOURCE_SCORE_INVALID', `Invalid ${field}: ${id}`);
    }
    if (!isDate(opportunity.eventDate) || !isDate(opportunity.prepareBy)) {
      fail('SOURCE_EVENT_DATE_INVALID', `Invalid event or preparation date: ${id}`);
    }
    if (!isDate(opportunity.sourceCheckedAt)) {
      fail('SOURCE_CHECK_DATE_REQUIRED', `Invalid source-check date: ${id}`);
    } else if (isDate(asOf)) {
      const sourceAge = daysBetween(opportunity.sourceCheckedAt, asOf);
      if (sourceAge < 0) fail('SOURCE_CHECK_DATE_IN_FUTURE', `Future source-check date: ${id}`);
      if (sourceAge >= MAX_SOURCE_AGE_DAYS) fail('SOURCE_FRESHNESS_EXPIRED', `Stale source-check date: ${id}`);
    }

    if (!source.fixture) {
      if (!isRealHttpsUrl(opportunity.sourceUrl)) {
        fail('SOURCE_URL_INVALID', `Non-live evidence URL: ${id}`);
      }
      if (!APPROVED_SOURCE_AUTHORITIES.has(opportunity.sourceAuthority)) {
        fail('SOURCE_AUTHORITY_UNAPPROVED', `Unapproved source authority: ${id}`);
      }
      if (opportunity.sourceAccessStatus !== "verified") {
        fail('SOURCE_VERIFICATION_REQUIRED', `Source was not opened and verified: ${id}`);
      }
    }
  }

  if (source.fixture) {
    warnings.push("Fixture source pack: demonstration only.");
  }
  return { passed: errors.length === 0, errors, warnings, codes: [...codes] };
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(left, right) {
  return Math.round(
    (new Date(`${right}T00:00:00Z`) - new Date(`${left}T00:00:00Z`)) /
      86_400_000,
  );
}

function isRealHttpsUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !["example.com", "example.net", "example.org"].includes(hostname) &&
      !hostname.endsWith(".example.com") &&
      !hostname.endsWith(".example.net") &&
      !hostname.endsWith(".example.org") &&
      !hostname.endsWith(".invalid") &&
      hostname !== "localhost"
    );
  } catch {
    return false;
  }
}
