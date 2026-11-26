// Admin sign-in: first-time setup, login, logout, who am I, change password.
import { json, fail, getUsers, saveUsers, hashPassword, checkPassword, sessionCookie, clearCookie, currentUser, sameOrigin, env } from "../lib/core.mjs";

const cleanEmail = e => String(e || "").trim().toLowerCase();
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default async (req, context) => {
  if (!sameOrigin(req)) return fail("Forbidden", 403);
  const action = new URL(req.url).pathname.split("/").pop();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (action === "me") {
    const users = await getUsers();
    return json({ user: await currentUser(req), needsSetup: users.length === 0 });
  }

  if (action === "setup" && req.method === "POST") {
    const users = await getUsers();
    if (users.length) return fail("Setup is already done. Please sign in.", 409);
    const code = env("ADMIN_SETUP_CODE");
    if (!code || body.code !== code) { await new Promise(r => setTimeout(r, 800)); return fail("That setup code is not right.", 401); }
    const email = cleanEmail(body.email);
    if (!okEmail(email) || !body.name || String(body.password || "").length < 10) return fail("Enter a name, a valid email, and a password of at least 10 characters.");
    const cookie = await sessionCookie(email);
    users.push({ email, name: String(body.name).slice(0, 60), ...hashPassword(body.password), created: new Date().toISOString() });
    await saveUsers(users);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }

  if (action === "login" && req.method === "POST") {
    const email = cleanEmail(body.email);
    const u = (await getUsers()).find(x => x.email === email);
    const ok = u && checkPassword(String(body.password || ""), u);
    if (!ok) { await new Promise(r => setTimeout(r, 800)); return fail("Email or password is not right.", 401); }
    const cookie = await sessionCookie(u.email);
    return json({ ok: true, user: { email: u.email, name: u.name } }, 200, { "Set-Cookie": cookie });
  }

  if (action === "logout" && req.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie });

  if (action === "password" && req.method === "POST") {
    const me = await currentUser(req);
    if (!me) return fail("Please sign in.", 401);
    const users = await getUsers();
    const u = users.find(x => x.email === me.email);
    if (!checkPassword(String(body.current || ""), u)) return fail("Your current password is not right.", 401);
    if (String(body.next || "").length < 10) return fail("New password must be at least 10 characters.");
    Object.assign(u, hashPassword(body.next));
    await saveUsers(users);
    return json({ ok: true });
  }

  return fail("Not found", 404);
};
export const config = { path: "/api/auth/:action" };
