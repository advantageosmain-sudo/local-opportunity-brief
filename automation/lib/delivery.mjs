import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateReport } from "./engine.mjs";

export class DeliveryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "DeliveryError";
    this.code = code;
    this.details = details;
  }
}

export function deliveryIdempotencyKey(report) {
  return `weekly-brief/${report.reportId}/${report.checksum}`.slice(0, 256);
}

export async function deliverApprovedReport({
  reportPath,
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const resolvedReportPath = path.resolve(reportPath);
  const reportDir = path.dirname(resolvedReportPath);
  const report = await readJson(resolvedReportPath);
  const approval = await readJson(path.join(reportDir, "approval.json"));
  const storedValidation = await readJson(path.join(reportDir, "validation.json"));
  const receiptPath = path.join(reportDir, "delivery-receipt.json");
  const claimPath = path.join(reportDir, "delivery-claim.json");
  const failurePath = path.join(reportDir, "delivery-failure.json");
  const uncertainPath = path.join(reportDir, "delivery-uncertain.json");

  if (!storedValidation.passed || !validateReport(report).passed) {
    throw new DeliveryError("REPORT_VALIDATION_FAILED");
  }
  if (approval.decision !== "APPROVED") {
    throw new DeliveryError("OWNER_APPROVAL_MISSING");
  }
  if (approval.checksum !== report.checksum) {
    throw new DeliveryError("APPROVAL_CHECKSUM_MISMATCH");
  }
  if (report.fixture) throw new DeliveryError("FIXTURE_REPORT_CANNOT_BE_DELIVERED");
  if (!report.deliveryEligible || report.customer.deliveryMode !== "customer") {
    throw new DeliveryError("REPORT_NOT_ELIGIBLE_FOR_CUSTOMER_DELIVERY");
  }
  if (!isDeliverableEmail(report.customer.deliveryEmail)) {
    throw new DeliveryError("INVALID_DELIVERY_RECIPIENT");
  }
  if (env.LIVE_DELIVERY !== "1") throw new DeliveryError("LIVE_DELIVERY_DISABLED");
  if (!env.RESEND_API_KEY) throw new DeliveryError("RESEND_API_KEY_MISSING");
  if (!env.DELIVERY_FROM_EMAIL) throw new DeliveryError("DELIVERY_FROM_EMAIL_MISSING");
  if (await exists(receiptPath)) throw new DeliveryError("DELIVERY_RECEIPT_ALREADY_EXISTS");
  if (await exists(uncertainPath)) {
    throw new DeliveryError("PREVIOUS_DELIVERY_OUTCOME_IS_UNCERTAIN");
  }

  const idempotencyKey = deliveryIdempotencyKey(report);
  const attempt = {
    status: "CLAIMED",
    reportId: report.reportId,
    checksum: report.checksum,
    idempotencyKey,
    claimedAt: now().toISOString(),
  };
  try {
    await writeFile(claimPath, `${JSON.stringify(attempt, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new DeliveryError("DELIVERY_IN_PROGRESS_OR_ALREADY_ATTEMPTED");
    }
    throw error;
  }

  const markdown = await readFile(path.join(reportDir, "report.md"), "utf8");
  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        from: env.DELIVERY_FROM_EMAIL,
        to: [report.customer.deliveryEmail],
        subject: `Your Local Opportunity Brief — week of ${report.weekOf}`,
        text: markdown,
      }),
    });
  } catch (error) {
    const uncertain = {
      status: "DELIVERY_OUTCOME_UNCERTAIN",
      reportId: report.reportId,
      failedAt: now().toISOString(),
      idempotencyKey,
      reason: error instanceof Error ? error.message : "Network request failed.",
      ownerAction: "Check the email provider before retrying.",
    };
    await writeFile(uncertainPath, `${JSON.stringify(uncertain, null, 2)}\n`, {
      flag: "wx",
    });
    throw new DeliveryError("EMAIL_PROVIDER_OUTCOME_UNCERTAIN", uncertain);
  }

  if (!response.ok) {
    const providerBody = (await response.text()).slice(0, 2_000);
    const failure = {
      status: "DELIVERY_FAILED",
      reportId: report.reportId,
      failedAt: now().toISOString(),
      idempotencyKey,
      provider: "resend",
      providerStatus: response.status,
      providerBody,
    };
    try {
      await writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`);
    } finally {
      await unlink(claimPath).catch(() => {});
    }
    throw new DeliveryError(`EMAIL_PROVIDER_FAILED_${response.status}`, failure);
  }

  try {
    const providerResult = await response.json();
    if (!providerResult?.id) throw new Error("Provider response did not include a message ID.");
    const receipt = {
      status: "DELIVERED",
      reportId: report.reportId,
      deliveredAt: now().toISOString(),
      provider: "resend",
      providerMessageId: providerResult.id,
      idempotencyKey,
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    await unlink(claimPath);
    return receipt;
  } catch (error) {
    const uncertain = {
      status: "DELIVERY_OUTCOME_UNCERTAIN",
      reportId: report.reportId,
      failedAt: now().toISOString(),
      idempotencyKey,
      reason: error instanceof Error ? error.message : "Delivery receipt could not be confirmed.",
      ownerAction: "Check the email provider before retrying.",
    };
    await writeFile(uncertainPath, `${JSON.stringify(uncertain, null, 2)}\n`, {
      flag: "wx",
    }).catch(() => {});
    throw new DeliveryError("EMAIL_PROVIDER_OUTCOME_UNCERTAIN", uncertain);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isDeliverableEmail(value) {
  if (typeof value !== "string" || value.length > 254) return false;
  const match = value.trim().toLowerCase().match(/^[^\s@]+@([^\s@]+)$/);
  if (!match) return false;
  const domain = match[1];
  return (
    domain.includes(".") &&
    !["example.com", "example.net", "example.org", "localhost"].includes(domain) &&
    !domain.endsWith(".invalid") &&
    !domain.endsWith(".test") &&
    !domain.endsWith(".localhost")
  );
}
