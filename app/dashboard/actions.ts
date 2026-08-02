"use server";

import { revalidatePath } from "next/cache";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureDatabase, getRuntimeEnv } from "@/db/runtime";

const ALLOWED_STATUSES = new Set([
  "new",
  "research_ready",
  "approved_for_test_checkout",
  "rejected",
]);

export async function setLeadPilotStatus(formData: FormData) {
  const user = await getChatGPTUser();
  const ownerEmail = getRuntimeEnv().OWNER_EMAIL?.trim().toLowerCase();
  if (!user || !ownerEmail || user.email.trim().toLowerCase() !== ownerEmail) {
    throw new Error("Owner approval is required.");
  }

  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!/^[a-f0-9-]{16,64}$/i.test(leadId) || !ALLOWED_STATUSES.has(status)) {
    throw new Error("Lead update is invalid.");
  }

  const database = await ensureDatabase();
  await database
    .prepare("UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, leadId)
    .run();
  revalidatePath("/dashboard");
}
