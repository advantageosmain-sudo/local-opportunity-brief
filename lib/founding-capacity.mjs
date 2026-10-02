// SQLite/D1 serializes this single conditional write, including competing requests.
// Paid founding places are lifetime allocations: canceling does not make an 11th
// person one of the first ten paying founders. Pending subscriptions stay held.
// Ordinary unpaid reservations expire; Stripe extends its holds until confirmed expiry.
export const RESERVATION_MINUTES = 30;
export const foundingSchema = `CREATE TABLE IF NOT EXISTS founding_reservations (
 customer_id TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(customer_id,mode))`;
export async function reserveFoundingPlace(db, customerId, mode, now = new Date(), reservationMinutes = RESERVATION_MINUTES) {
 const at=now.toISOString(), expires=new Date(now.getTime()+reservationMinutes*60000).toISOString();
 const result=await db.prepare(`INSERT INTO founding_reservations(customer_id,mode,state,expires_at,created_at)
 SELECT ?,?,'reserved',?,? WHERE ((
 SELECT COUNT(*) FROM founding_reservations WHERE mode=? AND (state IN ('paid','pending') OR (state='reserved' AND expires_at>?))) < 10 OR EXISTS(SELECT 1 FROM founding_reservations WHERE customer_id=? AND mode=? AND (state IN ('paid','pending') OR (state='reserved' AND expires_at>?))))
 AND NOT EXISTS(SELECT 1 FROM diagnostics WHERE status='open' AND code IN ('UNRESERVED_PAYMENT_REVIEW_REQUIRED','EXPIRED_RESERVATION_PAYMENT_REVIEW_REQUIRED') AND (json_extract(detail_json,'$.mode') IS NULL OR json_extract(detail_json,'$.mode')=?))
 AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.subscription_id IS NOT NULL
 AND ((?='test' AND c.payment_status LIKE 'test_%') OR (?='live' AND c.payment_status NOT LIKE 'test_%'))
 AND NOT EXISTS(SELECT 1 FROM founding_reservations f WHERE f.customer_id=c.id AND f.mode=? AND f.state IN ('paid','pending')))
 ON CONFLICT(customer_id,mode) DO UPDATE SET
 state=CASE WHEN founding_reservations.state IN ('paid','pending') THEN founding_reservations.state ELSE 'reserved' END,
 expires_at=CASE WHEN founding_reservations.expires_at<=? AND founding_reservations.state NOT IN ('paid','pending') THEN excluded.expires_at ELSE founding_reservations.expires_at END`)
 .bind(customerId,mode,expires,at,mode,at,customerId,mode,at,mode,mode,mode,mode,at).run();
 if(!result.meta.changes) return null;
 const row=await db.prepare('SELECT state,expires_at,mode FROM founding_reservations WHERE customer_id=? AND mode=?').bind(customerId,mode).first();
 return row?.mode===mode && (['paid','pending'].includes(row.state)||(row.state==='reserved'&&row.expires_at>at)) ? {state:row.state,expiresAt:row.expires_at} : null;
}
export async function releaseUnpaidPlace(db,customerId,mode) {
 await db.prepare("UPDATE founding_reservations SET state='released',expires_at='1970-01-01T00:00:00.000Z' WHERE customer_id=? AND mode=? AND state NOT IN ('paid','pending')").bind(customerId,mode).run();
}

