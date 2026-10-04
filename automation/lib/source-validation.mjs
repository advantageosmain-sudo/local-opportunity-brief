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
  const ids = new Set();

  if (!source || typeof source !== "object") {
    return { passed: false, errors: ["Source pack must be an object."], warnings };
  }
  if (typeof source.fixture !== "boolean") {
    errors.push("Source pack must explicitly declare fixture true or false.");
  }
  if (!Array.isArray(source.opportunities) || source.opportunities.length === 0) {
    errors.push("Source pack must contain at least one opportunity.");
  }

  for (const opportunity of source.opportunities ?? []) {
    const id = opportunity.id ?? "unknown";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      errors.push(`Unsafe opportunity id: ${id}`);
    }
    if (ids.has(id)) errors.push(`Duplicate source opportunity: ${id}`);
    ids.add(id);

    for (const field of ["title", "eventDate", "prepareBy", "city", "state", "sourceName", "sourceUrl", "sourceCheckedAt", "offerType"]) {
      if (!opportunity[field]) errors.push(`Missing ${field}: ${id}`);
    }
    for (const field of ["customerTags", "productTags"]) {
      if (!Array.isArray(opportunity[field]) || opportunity[field].length === 0) {
        errors.push(`Missing ${field}: ${id}`);
      }
    }
    if (opportunity.geographyMode !== "city_match" && (!Number.isFinite(opportunity.distanceMiles) || opportunity.distanceMiles < 0)) {
      errors.push(`Invalid distance: ${id}`);
    }
    if (!Number.isInteger(opportunity.sourceQuality) || opportunity.sourceQuality < 1 || opportunity.sourceQuality > 5) {
      errors.push(`Invalid source quality: ${id}`);
    }
    for (const field of ["urgency", "preparationEase"]) {
      if (!Number.isInteger(opportunity[field]) || opportunity[field] < 1 || opportunity[field] > 5) errors.push(`Invalid ${field}: ${id}`);
    }
    if (!isDate(opportunity.eventDate) || !isDate(opportunity.prepareBy)) {
      errors.push(`Invalid event or preparation date: ${id}`);
    }
    if (!isDate(opportunity.sourceCheckedAt)) {
      errors.push(`Invalid source-check date: ${id}`);
    } else if (isDate(asOf)) {
      const sourceAge = daysBetween(opportunity.sourceCheckedAt, asOf);
      if (sourceAge < 0) errors.push(`Future source-check date: ${id}`);
      if (sourceAge >= MAX_SOURCE_AGE_DAYS) errors.push(`Stale source-check date: ${id}`);
    }

    if (!source.fixture) {
      if (!isRealHttpsUrl(opportunity.sourceUrl)) {
        errors.push(`Non-live evidence URL: ${id}`);
      }
      if (!APPROVED_SOURCE_AUTHORITIES.has(opportunity.sourceAuthority)) {
        errors.push(`Unapproved source authority: ${id}`);
      }
      if (opportunity.sourceAccessStatus !== "verified") {
        errors.push(`Source was not opened and verified: ${id}`);
      }
    }
  }

  if (source.fixture) {
    warnings.push("Fixture source pack: demonstration only.");
  }
  return { passed: errors.length === 0, errors, warnings };
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

