import { Hono } from "hono";
import { Env } from "../types";
import {
  buildGoogleAuthUrl,
  generateState,
  generateCodeVerifier,
  setOAuthCookies,
  readOAuthCookies,
  clearOAuthCookies,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  upsertUserFromGoogle,
  createSession,
  setSessionCookie,
  getSession,
  destroySession,
  clearSessionCookie,
} from "../lib/auth";

const auth = new Hono<{ Bindings: Env }>();

auth.get("/google", async (c) => {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = await buildGoogleAuthUrl(c.env, state, verifier);
  setOAuthCookies(c, state, verifier);
  return c.redirect(url);
});

auth.get("/google/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const { state, verifier } = readOAuthCookies(c);
  clearOAuthCookies(c);

  if (!code || !returnedState || !state || returnedState !== state || !verifier) {
    return c.text("Invalid OAuth state. Please try signing in again.", 400);
  }

  try {
    const tokens = await exchangeGoogleCode(c.env, code, verifier);
    const info = await fetchGoogleUserInfo(tokens.access_token);
    const userId = await upsertUserFromGoogle(c.env, info);
    const sessionId = await createSession(c.env, userId);
    setSessionCookie(c, sessionId);
    return c.redirect("/dashboard.html");
  } catch (err) {
    console.error("Google OAuth error", err);
    return c.text("Sign-in failed. Please try again.", 400);
  }
});

auth.post("/logout", async (c) => {
  const session = await getSession(c);
  if (session) await destroySession(c.env, session.sessionId);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ user: null }, 401);

  const user = await c.env.DB
    .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
    .bind(session.userId)
    .first();

  return c.json({ user, active_company_id: session.activeCompanyId });
});

export default auth;
