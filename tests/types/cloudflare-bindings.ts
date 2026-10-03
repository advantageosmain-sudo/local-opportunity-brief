import type { D1Database } from "@/types/cloudflare-d1";

// Checked by npm run typecheck, never executed against a database.
export async function checkD1ResultTypes(database: D1Database) {
  const statement = database.prepare("SELECT id FROM customers");
  const typed = await statement.all<{ id: string }>();
  const id: string = typed.results[0].id;

  // @ts-expect-error Explicit row types must be preserved through all().
  const wrongId: number = typed.results[0].id;
  void wrongId;

  const untyped = await statement.all();
  // @ts-expect-error Unvalidated fields must remain unknown rather than any.
  const uncheckedId: string = untyped.results[0].id;
  void uncheckedId;

  const first = await statement.first<{ id: string }>();
  // @ts-expect-error D1 first() can return null and must be checked.
  const uncheckedFirst: string = first.id;
  void uncheckedFirst;

  // @ts-expect-error SQL statements must be strings.
  database.prepare(123);
  return id;
}
