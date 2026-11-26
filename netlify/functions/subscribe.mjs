// Public: saves an email from the "Stay locked in" signup box on the site.
import crypto from "node:crypto";
import { db, json, fail } from "../lib/core.mjs";

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  let body;
  try { body = await req.json(); } catch { return fail("Bad request"); }
  if (body.website) return json({ ok: true }); // hidden trap field: bots fill it, people don't
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter a valid email address.");
  const key = "subs/" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
  const store = db();
  const existing = await store.get(key, { type: "json" });
  if (!existing) await store.setJSON(key, { email, at: new Date().toISOString(), source: "website" });
  return json({ ok: true, already: !!existing });
};
export const config = { path: "/api/subscribe" };
