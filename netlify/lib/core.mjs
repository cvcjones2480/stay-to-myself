// Shared helpers for the Stay To Myself backend: storage, auth, catalog, Square.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import defaults from "../../products.json";

const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

/* ---------- storage ---------- */
export function db() {
  // Local testing can point at a blobs server; on Netlify this is automatic.
  if (env("BLOBS_EDGE_URL")) {
    return getStore({ name: "stm", edgeURL: env("BLOBS_EDGE_URL"), siteID: "local", token: env("BLOBS_TOKEN") || "local" });
  }
  return getStore({ name: "stm", consistency: "strong" });
}

export const DEFAULT_CONTENT = {
  banner: { on: true, text: "Launched on the founder's birthday, 11.25.26. Happy birthday, Tyrone!" },
  tagline: "Apparel built by an 18-year-old student athlete for anyone locked in on their future. No distractions. Just dedication.",
  founderName: "Tyrone Harrison, Jr.",
  story: [
    "Tyrone is an 18-year-old student athlete who plays football, basketball and baseball. He is in a dual enrollment program, so he will walk away with both his high school diploma and his associate degree, and he carries a 4.3 GPA while doing it.",
    "Stay To Myself is how he moves through a challenging world: keep the books open, keep the work in, and stay out of anything that could cost him his future. Now he is sharing that mindset with the world, one piece at a time."
  ],
  notTitle: "Not antisocial. Locked in.",
  notText: "STM is not about shutting people out. It is about protecting your goals, choosing your circle with purpose, and refusing to be pulled into behavior that does not serve where you are headed.",
  stats: [["18", "years old, founder and CEO"], ["4.3", "GPA, earned in the classroom"], ["3", "sports: football, basketball, baseball"], ["2", "credentials at once: H.S. diploma and associate degree"]],
  instagram: "", tiktok: ""
};

// Normalize a catalog so old and new shapes both work.
export function normalizeCatalog(c) {
  const out = {
    currency: "USD",
    shipping: { name: "Standard shipping", amount: 0, freeOver: 0 },
    taxPercent: null,
    sizeUpcharges: {},
    checkoutOpen: true,
    ...c
  };
  out.sizeUpcharges = Object.fromEntries(Object.entries(c.sizeUpcharges || {}).map(([k, v]) => [String(k).trim(), Math.max(0, Number(v) || 0)]).filter(([k, v]) => k && v > 0));
  out.shipping = { name: "Standard shipping", amount: 0, freeOver: 0, ...(c.shipping || {}) };
  out.products = (c.products || []).map(p => ({
    id: p.id, name: p.name, cat: p.cat || "Tees", price: Number(p.price) || 0, desc: p.desc || "",
    visible: p.visible !== false,
    sizes: Array.isArray(p.sizes) ? p.sizes.map(String) : [],
    soldOut: Array.isArray(p.soldOut) ? p.soldOut.map(String) : [],
    looks: (p.looks || []).map(l => [String(l[0]), String(l[1] || "#111111"), String(l[2] || "")])
  }));
  return out;
}

// Price for one item in a given size: base price plus any size upcharge.
export const unitPrice = (cat, p, size) => Math.round((Number(p.price) + (Number(cat.sizeUpcharges?.[size]) || 0)) * 100) / 100;

export async function getCatalog() {
  const saved = await db().get("catalog", { type: "json" });
  const { _readme, ...d } = defaults;
  return normalizeCatalog(saved || d);
}
export async function getContent() {
  const saved = await db().get("content", { type: "json" });
  return { ...DEFAULT_CONTENT, ...(saved || {}) };
}

/* ---------- responses ---------- */
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
export const fail = (msg, status = 400) => json({ error: msg }, status);

/* ---------- auth ---------- */
// Session signing key: ADMIN_SECRET if set in Netlify, otherwise one the site makes
// for itself on first use and keeps in private storage. Nobody has to type it.
let _secret;
async function secret() {
  if (_secret) return _secret;
  const fromEnv = env("ADMIN_SECRET");
  if (fromEnv && fromEnv.length >= 24) return (_secret = fromEnv);
  const store = db();
  let s = await store.get("config/session-secret", { type: "text" });
  if (!s) {
    s = crypto.randomBytes(32).toString("base64url");
    await store.set("config/session-secret", s, { onlyIfNew: true }).catch(() => {});
    s = (await store.get("config/session-secret", { type: "text" })) || s;
  }
  return (_secret = s);
}
export function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") };
}
export function checkPassword(pw, user) {
  const h = crypto.scryptSync(pw, user.salt, 64);
  const want = Buffer.from(user.hash, "hex");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const b64 = s => Buffer.from(s).toString("base64url");
const sign = async data => crypto.createHmac("sha256", await secret()).update(data).digest("base64url");

export async function sessionCookie(email) {
  const body = b64(JSON.stringify({ e: email, x: Date.now() + 7 * 864e5 }));
  const tok = `${body}.${await sign(body)}`;
  return `stm_session=${tok}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 86400}`;
}
export const clearCookie = "stm_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";

export async function getUsers() { return (await db().get("users", { type: "json" })) || []; }
export async function saveUsers(u) { await db().setJSON("users", u); }

// Returns the signed-in user, or null.
export async function currentUser(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)stm_session=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  const good = await sign(body);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p.x || p.x < Date.now()) return null;
  const u = (await getUsers()).find(x => x.email === p.e);
  return u ? { email: u.email, name: u.name } : null;
}

// Blocks cross-site form posts to admin endpoints.
export function sameOrigin(req) {
  if (req.method === "GET") return true;
  const o = req.headers.get("origin");
  if (!o) return true;
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}

/* ---------- Square ---------- */
export const ORDER_TAG = "STM-WEB";
const squareBase = () => env("SQUARE_API_BASE") || (env("SQUARE_ENV") === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com");
export async function square(path, method = "GET", body) {
  const res = await fetch(squareBase() + path, {
    method,
    headers: { Authorization: `Bearer ${env("SQUARE_ACCESS_TOKEN")}`, "Content-Type": "application/json", "Square-Version": "2024-10-17" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error("Square " + res.status + " " + JSON.stringify(data.errors || data)); e.status = res.status; throw e; }
  return data;
}
export const squareReady = () => !!(env("SQUARE_ACCESS_TOKEN") && env("SQUARE_LOCATION_ID"));
export { env };

const money = m => (m && typeof m.amount === "number") ? m.amount / 100 : 0;

// Turn a paid Square order into the record the admin shows.
export function orderRecord(o, existing) {
  const f = (o.fulfillments || []).find(x => x.shipment_details) || {};
  const r = f.shipment_details?.recipient || {};
  const a = r.address || {};
  return {
    id: o.id,
    createdAt: o.created_at,
    status: existing?.status || "new",
    tracking: existing?.tracking || "",
    note: existing?.note || "",
    customer: {
      name: r.display_name || "",
      email: r.email_address || "",
      phone: r.phone_number || "",
      address: [a.address_line_1, a.address_line_2, [a.locality, a.administrative_district_level_1, a.postal_code].filter(Boolean).join(", ")].filter(Boolean).join("\n")
    },
    items: (o.line_items || []).map(li => ({ name: li.name, variation: li.variation_name || "", qty: Number(li.quantity) || 1, price: money(li.base_price_money) })),
    shipping: money(o.total_service_charge_money),
    tax: money(o.total_tax_money),
    total: money(o.total_money)
  };
}

export async function saveSquareOrder(order) {
  if (order.reference_id !== ORDER_TAG) return null;
  if (!(order.tenders || []).length && order.state !== "COMPLETED") return null; // not paid yet
  const store = db();
  const key = "orders/" + order.id;
  const existing = await store.get(key, { type: "json" });
  const rec = orderRecord(order, existing);
  await store.setJSON(key, rec);
  return { rec, isNew: !existing };
}

/* ---------- email alert (optional, via Resend) ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export async function emailOrderAlert(rec) {
  const key = env("RESEND_API_KEY"), to = env("ALERT_EMAIL_TO"), from = env("ALERT_EMAIL_FROM");
  if (!key || !to || !from) return;
  const rows = rec.items.map(i => `<tr><td>${esc(i.qty)} × ${esc(i.name)}</td><td>${esc(i.variation)}</td><td align="right">$${(i.price * i.qty).toFixed(2)}</td></tr>`).join("");
  const html = `<h2>New STM order</h2><p><b>${esc(rec.customer.name)}</b><br>${esc(rec.customer.address).replace(/\n/g, "<br>")}<br>${esc(rec.customer.email)} ${esc(rec.customer.phone)}</p>
    <table cellpadding="6" style="border-collapse:collapse">${rows}</table>
    <p>Shipping $${rec.shipping.toFixed(2)} · Tax $${rec.tax.toFixed(2)} · <b>Total $${rec.total.toFixed(2)}</b></p>
    <p>Mark it packed and shipped in the STM admin.</p>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map(s => s.trim()), subject: `New STM order: ${rec.items.reduce((a, i) => a + i.qty, 0)} item(s), $${rec.total.toFixed(2)}`, html })
  }).catch(e => console.error("email failed", e));
}
