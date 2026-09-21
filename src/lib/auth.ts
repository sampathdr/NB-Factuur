import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Env } from "../types";
import { newId, newOpaqueToken } from "./util";

const SESSION_COOKIE = "nbf_session";
const OAUTH_STATE_COOKIE = "nbf_oauth_state";
const OAUTH_VERIFIER_COOKIE = "nbf_oauth_verifier";
const SESSION_TTL_DAYS = 30;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// --- Minimal Google OAuth 2.0 (Authorization Code + PKCE) client ---
// Implemented directly against Google's endpoints rather than via a
// third-party OAuth library, since the popular `arctic` package is no
// longer maintained by its author.

export function generateState(): string {
  return newOpaqueToken();
}

export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function buildGoogleAuthUrl(
  env: Env,
  state: string,
  verifier: string
): Promise<string> {
  const challenge = await codeChallengeFromVerifier(verifier);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  verifier: string
): Promise<{ access_token: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `${env.APP_URL}/auth/google/callback`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${body}`);
  }
  return res.json();
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Google user info");
  return res.json();
}

// --- OAuth transaction cookies (short-lived, protect against CSRF/replay) ---

export function setOAuthCookies(c: Context, state: string, verifier: string) {
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: 60 * 10,
  };
  setCookie(c, OAUTH_STATE_COOKIE, state, opts);
  setCookie(c, OAUTH_VERIFIER_COOKIE, verifier, opts);
}

export function readOAuthCookies(c: Context) {
  return {
    state: getCookie(c, OAUTH_STATE_COOKIE),
    verifier: getCookie(c, OAUTH_VERIFIER_COOKIE),
  };
}

export function clearOAuthCookies(c: Context) {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: "/" });
}

// --- User + session persistence (D1-backed) ---

export async function upsertUserFromGoogle(env: Env, info: GoogleUserInfo): Promise<string> {
  const existing = await env.DB
    .prepare("SELECT id FROM users WHERE google_sub = ?")
    .bind(info.sub)
    .first<{ id: string }>();

  if (existing) {
    await env.DB
      .prepare("UPDATE users SET email = ?, name = ?, avatar_url = ? WHERE id = ?")
      .bind(info.email, info.name ?? null, info.picture ?? null, existing.id)
      .run();
    return existing.id;
  }

  const id = newId();
  await env.DB
    .prepare(
      "INSERT INTO users (id, google_sub, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, info.sub, info.email, info.name ?? null, info.picture ?? null)
    .run();
  return id;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const id = newOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString();
  await env.DB
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expiresAt)
    .run();
  return id;
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  activeCompanyId: string | null;
}

export async function getSession<E extends { Bindings: Env }>(
  c: Context<E>
): Promise<SessionInfo | null> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return null;

  const row = await c.env.DB
    .prepare(
      "SELECT id, user_id, active_company_id, expires_at FROM sessions WHERE id = ?"
    )
    .bind(sessionId)
    .first<{ id: string; user_id: string; active_company_id: string | null; expires_at: string }>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
    return null;
  }

  return { sessionId: row.id, userId: row.user_id, activeCompanyId: row.active_company_id };
}

export async function setActiveCompany(env: Env, sessionId: string, companyId: string) {
  await env.DB
    .prepare("UPDATE sessions SET active_company_id = ? WHERE id = ?")
    .bind(companyId, sessionId)
    .run();
}

export async function destroySession(env: Env, sessionId: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}
