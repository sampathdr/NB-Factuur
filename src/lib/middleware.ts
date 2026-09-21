import { Context, Next } from "hono";
import { Env } from "../types";
import { getSession, SessionInfo } from "./auth";

export type AuthedVars = { session: SessionInfo };

export async function requireAuth(
  c: Context<{ Bindings: Env; Variables: AuthedVars }>,
  next: Next
) {
  const session = await getSession(c);
  if (!session) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  c.set("session", session);
  await next();
}

/**
 * Confirms the current user owns the company referenced by :companyId,
 * so one tenant can never read or write another tenant's data.
 */
export async function requireCompanyOwnership(
  c: Context<{ Bindings: Env; Variables: AuthedVars }>,
  companyId: string
): Promise<boolean> {
  const row = await c.env.DB
    .prepare("SELECT id FROM companies WHERE id = ? AND owner_user_id = ?")
    .bind(companyId, c.get("session").userId)
    .first();
  return !!row;
}
