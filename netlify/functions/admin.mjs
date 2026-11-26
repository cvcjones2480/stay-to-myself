// Signed-in admin API: catalog, settings, content, photos, orders, team.
import crypto from "node:crypto";
import { db, json, fail, currentUser, sameOrigin, getCatalog, getContent, normalizeCatalog, DEFAULT_CONTENT,
  getUsers, saveUsers, hashPassword, square, squareReady, env, saveSquareOrder } from "../lib/core.mjs";

const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const str = (v, n = 2000) => String(v ?? "").slice(0, n);

function validateCatalog(c) {
  const n = normalizeCatalog(c);
  const ids = new Set();
  for (const p of n.products) {
    if (!/^[a-z0-9-]{2,60}$/.test(p.id || "")) throw new Error(`"${p.name || "A product"}" needs a simple ID (lowercase letters, numbers, dashes).`);
    if (ids.has(p.id)) throw new Error(`Two products share the ID "${p.id}".`);
    ids.add(p.id);
    if (!p.name) throw new Error("Every product needs a name.");
    if (!(p.price > 0)) throw new Error(`"${p.name}" needs a price above $0.`);
    if (!p.sizes.length) throw new Error(`"${p.name}" needs at least one size.`);
    if (!p.looks.length || p.looks.some(l => !l[0] || !l[2])) throw new Error(`"${p.name}" needs at least one color, and every color needs a name and a photo.`);
    p.name = str(p.name, 80); p.desc = str(p.desc, 300); p.cat = str(p.cat, 30);
    p.soldOut = p.soldOut.filter(s => p.sizes.includes(s));
  }
  const tax = n.taxPercent === "" || n.taxPercent == null ? null : Number(n.taxPercent);
  if (tax != null && !(tax >= 0 && tax < 20)) throw new Error("Sales tax should be a percent between 0 and 20, or blank.");
  n.taxPercent = tax;
  for (const [k, v] of Object.entries(n.sizeUpcharges)) {
    if (k.length > 12) throw new Error(`Size "${k}" is too long.`);
    if (v > 200) throw new Error(`The upcharge for ${k} looks too high.`);
  }
  n.shipping = { name: str(n.shipping.name, 40) || "Shipping", amount: Math.max(0, Number(n.shipping.amount) || 0), freeOver: Math.max(0, Number(n.shipping.freeOver) || 0) };
  n.checkoutOpen = !!n.checkoutOpen;
  return n;
}

export default async (req, context) => {
  if (!sameOrigin(req)) return fail("Forbidden", 403);
  const me = await currentUser(req);
  if (!me) return fail("Please sign in.", 401);
  const store = db();
  const [section, id] = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").split("/");
  const m = req.method;

  try {
    /* catalog + store settings */
    if (section === "catalog" && m === "GET") return json(await getCatalog());
    if (section === "catalog" && m === "PUT") {
      const c = validateCatalog(await req.json());
      await store.setJSON("catalog", c);
      await store.setJSON("log/" + Date.now(), { who: me.email, what: "catalog" });
      return json(c);
    }

    /* site content */
    if (section === "content" && m === "GET") return json(await getContent());
    if (section === "content" && m === "PUT") {
      const b = await req.json();
      const c = {
        banner: { on: !!b.banner?.on, text: str(b.banner?.text, 160) },
        tagline: str(b.tagline, 300), founderName: str(b.founderName, 80),
        story: (b.story || []).map(s => str(s, 1200)).filter(Boolean).slice(0, 4),
        notTitle: str(b.notTitle, 80), notText: str(b.notText, 600),
        stats: (b.stats || DEFAULT_CONTENT.stats).slice(0, 4).map(s => [str(s[0], 8), str(s[1], 80)]),
        instagram: /^https:\/\//.test(b.instagram || "") ? str(b.instagram, 200) : "",
        tiktok: /^https:\/\//.test(b.tiktok || "") ? str(b.tiktok, 200) : ""
      };
      await store.setJSON("content", c);
      return json(c);
    }

    /* photo upload (browser sends a resized JPEG or PNG) */
    if (section === "image" && m === "POST") {
      const type = req.headers.get("content-type") || "";
      if (!/^image\/(jpeg|png|webp)$/.test(type)) return fail("Upload a JPG, PNG or WebP image.");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 4 * 1024 * 1024) return fail("That photo is too large. Try one under 4 MB.");
      const key = crypto.randomUUID();
      await store.set("img/" + key, buf, { metadata: { type, by: me.email } });
      return json({ url: "/api/img/" + key });
    }

    /* orders */
    if (section === "orders" && m === "GET") {
      const { blobs } = await store.list({ prefix: "orders/" });
      const all = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
      all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ orders: all, squareReady: squareReady(), env: env("SQUARE_ENV") || "sandbox" });
    }
    if (section === "orders" && m === "PATCH" && id) {
      const key = "orders/" + id;
      const o = await store.get(key, { type: "json" });
      if (!o) return fail("Order not found", 404);
      const b = await req.json();
      if (["new", "packed", "shipped", "canceled"].includes(b.status)) o.status = b.status;
      if (b.tracking !== undefined) o.tracking = str(b.tracking, 80);
      if (b.note !== undefined) o.note = str(b.note, 500);
      o.updatedBy = me.email; o.updatedAt = new Date().toISOString();
      await store.setJSON(key, o);
      return json(o);
    }
    if (section === "sync" && m === "POST") {
      if (!squareReady()) return fail("Square keys are not set yet.", 503);
      const start = new Date(Date.now() - 90 * 864e5).toISOString();
      let cursor, added = 0, seen = 0;
      do {
        const d = await square("/v2/orders/search", "POST", {
          location_ids: [env("SQUARE_LOCATION_ID")], cursor, limit: 100,
          query: { filter: { state_filter: { states: ["OPEN", "COMPLETED"] }, date_time_filter: { created_at: { start_at: start } } },
                   sort: { sort_field: "CREATED_AT", sort_order: "DESC" } }
        });
        for (const o of d.orders || []) { const r = await saveSquareOrder(o); if (r) { seen++; if (r.isNew) added++; } }
        cursor = d.cursor;
      } while (cursor);
      return json({ ok: true, added, seen });
    }

    /* team */
    if (section === "users" && m === "GET") return json((await getUsers()).map(u => ({ email: u.email, name: u.name, created: u.created })));
    if (section === "users" && m === "POST") {
      const b = await req.json(); const email = String(b.email || "").trim().toLowerCase();
      if (!okEmail(email) || !b.name || String(b.password || "").length < 10) return fail("Enter a name, a valid email, and a temporary password of at least 10 characters.");
      const users = await getUsers();
      const ex = users.find(u => u.email === email);
      if (ex) Object.assign(ex, { name: str(b.name, 60) }, hashPassword(b.password));
      else users.push({ email, name: str(b.name, 60), ...hashPassword(b.password), created: new Date().toISOString() });
      await saveUsers(users);
      return json({ ok: true, reset: !!ex });
    }
    if (section === "users" && m === "DELETE" && id) {
      const email = decodeURIComponent(id);
      if (email === me.email) return fail("You can't remove yourself.");
      const users = (await getUsers()).filter(u => u.email !== email);
      if (!users.length) return fail("At least one person must keep access.");
      await saveUsers(users);
      return json({ ok: true });
    }
  } catch (e) {
    return fail(e.message || "Something went wrong.", 400);
  }
  return fail("Not found", 404);
};
export const config = { path: "/api/admin/*" };
