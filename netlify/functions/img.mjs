// Public: serves product photos uploaded in the admin.
import { db } from "../lib/core.mjs";

export default async (req, context) => {
  const key = new URL(req.url).pathname.split("/").pop();
  if (!/^[a-z0-9-]{8,64}$/.test(key || "")) return new Response("Not found", { status: 404 });
  const r = await db().getWithMetadata("img/" + key, { type: "arrayBuffer" });
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(r.data, {
    headers: { "Content-Type": r.metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" }
  });
};
export const config = { path: "/api/img/:key" };
