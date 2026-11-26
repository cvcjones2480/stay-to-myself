// Public: turns the cart into a Square-hosted checkout page.
// Prices, sizes and sold-out status come from the saved catalog, never from the browser.
import crypto from "node:crypto";
import { getCatalog, json, fail, square, squareReady, env, ORDER_TAG, unitPrice } from "../lib/core.mjs";

const cents = d => Math.round(Number(d) * 100);

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  if (!squareReady()) return fail("Checkout is not connected yet. Please check back soon.", 503);
  const cat = await getCatalog();
  if (!cat.checkoutOpen) return fail("The shop is closed right now. Please check back soon.", 403);

  let items, shipTo;
  try { ({ items, shipTo } = await req.json()); } catch { return fail("Bad request"); }
  const taxable = Number(cat.taxPercent) > 0;
  if (taxable && !shipTo) return fail("Please choose where your order is shipping.");
  if (!Array.isArray(items) || !items.length || items.length > 30) return fail("Your cart is empty.");

  const byId = Object.fromEntries(cat.products.filter(p => p.visible).map(p => [p.id, p]));
  const line_items = [];
  let subtotal = 0;
  for (const it of items) {
    const p = byId[it.id], qty = parseInt(it.qty, 10);
    if (!p || !p.sizes.includes(it.size) || !p.looks.some(l => l[0] === it.color) || !(qty >= 1 && qty <= 10)) {
      return fail("One of the items in your cart is no longer available. Please refresh and try again.", 409);
    }
    if (p.soldOut.includes(it.size)) return fail(`${p.name} in size ${it.size} just sold out. Please remove it and try again.`, 409);
    const unit = unitPrice(cat, p, it.size);
    subtotal += unit * qty;
    line_items.push({ name: p.name, variation_name: `${it.color} / ${it.size}`, quantity: String(qty),
      base_price_money: { amount: cents(unit), currency: cat.currency } });
  }

  const order = { location_id: env("SQUARE_LOCATION_ID"), reference_id: ORDER_TAG, line_items };
  // Sales tax applies only to orders shipping to the business's home state (Virginia by default).
  if (taxable && shipTo === cat.taxState) order.taxes = [{ uid: "sales-tax", name: `${cat.taxState} sales tax`, percentage: String(cat.taxPercent), scope: "ORDER" }];
  if (taxable) order.metadata = { ship_to: shipTo === cat.taxState ? cat.taxState : "outside" };

  const site = env("SITE_URL") || new URL(req.url).origin;
  const checkout_options = { ask_for_shipping_address: true, redirect_url: `${site}/?order=success` };
  const freeShip = cat.shipping.freeOver > 0 && subtotal >= cat.shipping.freeOver;
  if (cat.shipping.amount > 0 && !freeShip) {
    checkout_options.shipping_fee = { name: cat.shipping.name || "Shipping", charge: { amount: cents(cat.shipping.amount), currency: cat.currency } };
  }

  try {
    const d = await square("/v2/online-checkout/payment-links", "POST", { idempotency_key: crypto.randomUUID(), order, checkout_options });
    return json({ url: d.payment_link.url });
  } catch (e) {
    console.error(e.message);
    return fail("Checkout is temporarily unavailable. Please try again in a moment.", 502);
  }
};
export const config = { path: "/api/checkout" };
