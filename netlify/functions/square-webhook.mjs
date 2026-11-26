// Square calls this when a payment changes. Paid website orders are saved for the admin
// and (optionally) emailed to the team with full details.
import crypto from "node:crypto";
import { env, square, saveSquareOrder, emailOrderAlert } from "../lib/core.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const key = env("SQUARE_WEBHOOK_SIGNATURE_KEY"), url = env("SQUARE_WEBHOOK_URL");
  if (!key || !url) return new Response("Webhook not configured", { status: 503 });

  // Square signs: HMAC-SHA256(notification URL + raw body), base64.
  const expected = crypto.createHmac("sha256", key).update(url + raw).digest("base64");
  const got = req.headers.get("x-square-hmacsha256-signature") || "";
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return new Response("Bad signature", { status: 401 });
  }

  let evt; try { evt = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const pay = evt?.data?.object?.payment;
  if (!pay || pay.status !== "COMPLETED" || !pay.order_id) return new Response("ignored");

  try {
    const { order } = await square(`/v2/orders/${pay.order_id}`);
    const r = await saveSquareOrder(order);
    if (r?.isNew) await emailOrderAlert(r.rec);
  } catch (e) {
    console.error("webhook", e.message);
    return new Response("retry", { status: 500 }); // Square retries on errors
  }
  return new Response("ok");
};
export const config = { path: "/api/square-webhook" };
