import { Hono } from "hono";
import { Env } from "../types";
import { AuthedVars, requireAuth, requireCompanyOwnership } from "../lib/middleware";
import { newId } from "../lib/util";

const clients = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
clients.use("*", requireAuth);

async function assertCompanyAccess(
  c: import("hono").Context<{ Bindings: Env; Variables: AuthedVars }>,
  companyId: string
) {
  return requireCompanyOwnership(c, companyId);
}

clients.get("/", async (c) => {
  const companyId = c.req.query("company_id");
  if (!companyId) return c.json({ error: "company_id is required" }, 400);
  if (!(await assertCompanyAccess(c, companyId))) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB
    .prepare("SELECT * FROM clients WHERE company_id = ? ORDER BY name")
    .bind(companyId)
    .all();
  return c.json({ clients: results });
});

clients.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const companyId = String(body.company_id ?? "");
  if (!(await assertCompanyAccess(c, companyId))) return c.json({ error: "Not found" }, 404);

  const name = String(body.name ?? "").trim();
  const address_line1 = String(body.address_line1 ?? "").trim();
  const postal_code = String(body.postal_code ?? "").trim();
  const city = String(body.city ?? "").trim();
  if (!name || !address_line1 || !postal_code || !city) {
    return c.json({ error: "name, address_line1, postal_code and city are required" }, 400);
  }

  const id = newId();
  await c.env.DB
    .prepare(
      `INSERT INTO clients
        (id, company_id, name, contact_name, address_line1, postal_code, city, country,
         vat_number, kvk_number, email, is_eu_business)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      companyId,
      name,
      body.contact_name ?? null,
      address_line1,
      postal_code,
      city,
      body.country ?? "Nederland",
      body.vat_number ?? null,
      body.kvk_number ?? null,
      body.email ?? null,
      body.is_eu_business ? 1 : 0
    )
    .run();

  const client = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return c.json({ client }, 201);
});

clients.put("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB
    .prepare("SELECT company_id FROM clients WHERE id = ?")
    .bind(id)
    .first<{ company_id: string }>();
  if (!existing || !(await assertCompanyAccess(c, existing.company_id))) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = await c.req.json<Record<string, unknown>>();
  await c.env.DB
    .prepare(
      `UPDATE clients SET
        name = COALESCE(?, name),
        contact_name = ?,
        address_line1 = COALESCE(?, address_line1),
        postal_code = COALESCE(?, postal_code),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        vat_number = ?,
        kvk_number = ?,
        email = ?,
        is_eu_business = COALESCE(?, is_eu_business)
       WHERE id = ?`
    )
    .bind(
      body.name ?? null,
      body.contact_name ?? null,
      body.address_line1 ?? null,
      body.postal_code ?? null,
      body.city ?? null,
      body.country ?? null,
      body.vat_number ?? null,
      body.kvk_number ?? null,
      body.email ?? null,
      body.is_eu_business === undefined ? null : body.is_eu_business ? 1 : 0,
      id
    )
    .run();

  const client = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return c.json({ client });
});

clients.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB
    .prepare("SELECT company_id FROM clients WHERE id = ?")
    .bind(id)
    .first<{ company_id: string }>();
  if (!existing || !(await assertCompanyAccess(c, existing.company_id))) {
    return c.json({ error: "Not found" }, 404);
  }
  await c.env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default clients;
