// Public: products, store settings and site content for the website.
import { getCatalog, getContent, json } from "../lib/core.mjs";

export default async () => {
  const [c, content] = await Promise.all([getCatalog(), getContent()]);
  return json({
    currency: c.currency, shipping: c.shipping, taxPercent: c.taxPercent, taxState: c.taxState, sizeUpcharges: c.sizeUpcharges, checkoutOpen: c.checkoutOpen,
    products: c.products.filter(p => p.visible),
    content
  });
};
export const config = { path: "/api/store" };
