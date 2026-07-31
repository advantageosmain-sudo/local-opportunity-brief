import { getDb } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { leads } from "@/db/schema";
import { validateIntake } from "@/lib/intake";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json(
      { error: "Submit the form using the website." },
      { status: 415 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "The form could not be read." }, { status: 400 });
  }

  const validated = validateIntake(payload);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  try {
    await ensureDatabase();
    const data = validated.data;
    await getDb().insert(leads).values({
      id: crypto.randomUUID(),
      contactName: data.contactName,
      email: data.email,
      businessName: data.businessName,
      website: data.website,
      city: data.city,
      state: data.state,
      category: data.category,
      localRadius: data.localRadius,
      products: data.products,
      customers: data.customers,
      voice: data.voice,
      exclusions: data.exclusions,
      notes: data.notes,
      status: "new",
    });

    return Response.json(
      {
        message:
          "Your request is saved. We will review your business and local source coverage before offering a paid founding spot.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("intake_save_failed", error);
    return Response.json(
      {
        error:
          "We could not save your request right now. Nothing was charged. Please try again.",
      },
      { status: 503 },
    );
  }
}
