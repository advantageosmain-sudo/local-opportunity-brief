export type IntakePayload = {
  businessName: string;
  category: string;
  city: string;
  companyFax: string;
  contactName: string;
  customers: string;
  email: string;
  exclusions: string;
  localRadius: number;
  notes: string;
  products: string;
  state: string;
  voice: string;
  website: string;
};

const allowedCategories = new Set([
  "boutique",
  "gift-shop",
  "apparel-shop",
  "other-retail",
]);

function value(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

export function validateIntake(input: unknown):
  | { ok: true; data: IntakePayload }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Please complete the business form." };
  }

  const payload = input as Record<string, unknown>;
  const companyFax = value(payload.companyFax, 300);
  if (companyFax) {
    return { ok: false, error: "We could not accept this request." };
  }

  const contactName = value(payload.contactName, 100);
  const email = value(payload.email, 180).toLowerCase();
  const businessName = value(payload.businessName, 140);
  const website = value(payload.website, 300);
  const city = value(payload.city, 100);
  const state = value(payload.state, 2).toUpperCase();
  const category = value(payload.category, 40);
  const products = value(payload.products, 1500);
  const customers = value(payload.customers, 1200);
  const voice = value(payload.voice, 300);
  const exclusions = value(payload.exclusions, 500);
  const notes = value(payload.notes, 1500);
  const localRadius = Number(value(payload.localRadius, 3) || "35");
  const consent = value(payload.consent, 8);

  if (!contactName || !businessName || !city || !products || !customers || !voice) {
    return { ok: false, error: "Please complete every required field." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid business email address." };
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return { ok: false, error: "Enter the two-letter state abbreviation." };
  }
  if (!allowedCategories.has(category)) {
    return { ok: false, error: "Select a supported retail business type." };
  }
  if (![15, 25, 35, 50].includes(localRadius)) {
    return { ok: false, error: "Select one of the available local distances." };
  }
  if (consent !== "yes") {
    return { ok: false, error: "Please agree to the privacy notice." };
  }
  if (website) {
    try {
      const url = new URL(website);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return { ok: false, error: "Enter a valid website address beginning with https://." };
    }
  }

  return {
    ok: true,
    data: {
      businessName,
      category,
      city,
      companyFax: "",
      contactName,
      customers,
      email,
      exclusions,
      localRadius,
      notes,
      products,
      state,
      voice,
      website,
    },
  };
}
