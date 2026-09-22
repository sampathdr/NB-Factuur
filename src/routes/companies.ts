import { Hono } from "hono";
import { Env, VatScheme } from "../types";
import { AuthedVars, requireAuth, requireCompanyOwnership } from "../lib/middleware";
import { newId, COMPANY_COLUMNS } from "../lib/util";
import { setActiveCompany } from "../lib/auth";

const companies = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
companies.use("*", requireAuth);

const VALID_VAT_SCHEMES: VatScheme[] = ["standard", "kor", "reverse_charge"];

companies.get("/", async (c) => {
  const session = c.get("session");
  const { results } = await c.env.DB
    .prepare(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE owner_user_id = ? ORDER BY created_at`)
    .bind(session.userId)
    .all();
  return c.json({ companies: results, active_company_id: session.activeCompanyId });
});

companies.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<Record<string, unknown>>();

  const legal_name = String(body.legal_name ?? "").trim();
  const address_line1 = String(body.address_line1 ?? "").trim();
  const postal_code = String(body.postal_code ?? "").trim();
  const city = String(body.city ?? "").trim();
  const kvk_number = String(body.kvk_number ?? "").trim();
  const vat_scheme = VALID_VAT_SCHEMES.includes(body.vat_scheme as VatScheme)
    ? (body.vat_scheme as VatScheme)
    : "standard";

  if (!legal_name || !address_line1 || !postal_code || !city || !kvk_number) {
    return c.json(
      { error: "legal_name, address_line1, postal_code, city and kvk_number are required" },
      400
    );
  }
  if (vat_scheme !== "kor" && !body.vat_number) {
    return c.json({ error: "vat_number is required unless vat_scheme is 'kor'" }, 400);
  }

  const id = newId();
  await c.env.DB
    .prepare(
      `INSERT INTO companies
        (id, owner_user_id, legal_name, trade_name, address_line1, postal_code, city, country,
         kvk_number, vat_number, vat_scheme, iban, bic, email, phone, default_currency, invoice_prefix)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      session.userId,
      legal_name,
      body.trade_name ?? null,
      address_line1,
      postal_code,
      city,
      body.country ?? "Nederland",
      kvk_number,
      body.vat_number ?? null,
      vat_scheme,
      body.iban ?? null,
      body.bic ?? null,
      body.email ?? null,
      body.phone ?? null,
      body.default_currency ?? "EUR",
      body.invoice_prefix ?? "INV"
    )
    .run();

  await setActiveCompany(c.env, session.sessionId, id);

  const company = await c.env.DB.prepare(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`).bind(id).first();
  return c.json({ company }, 201);
});

companies.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await requireCompanyOwnership(c, id))) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const vat_scheme = VALID_VAT_SCHEMES.includes(body.vat_scheme as VatScheme)
    ? (body.vat_scheme as VatScheme)
    : undefined;

  await c.env.DB
    .prepare(
      `UPDATE companies SET
        legal_name = COALESCE(?, legal_name),
        trade_name = ?,
        address_line1 = COALESCE(?, address_line1),
        postal_code = COALESCE(?, postal_code),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        kvk_number = COALESCE(?, kvk_number),
        vat_number = ?,
        vat_scheme = COALESCE(?, vat_scheme),
        iban = ?,
        bic = ?,
        email = ?,
        phone = ?,
        default_currency = COALESCE(?, default_currency),
        invoice_prefix = COALESCE(?, invoice_prefix)
       WHERE id = ?`
    )
    .bind(
      body.legal_name ?? null,
      body.trade_name ?? null,
      body.address_line1 ?? null,
      body.postal_code ?? null,
      body.city ?? null,
      body.country ?? null,
      body.kvk_number ?? null,
      body.vat_number ?? null,
      vat_scheme ?? null,
      body.iban ?? null,
      body.bic ?? null,
      body.email ?? null,
      body.phone ?? null,
      body.default_currency ?? null,
      body.invoice_prefix ?? null,
      id
    )
    .run();

  const company = await c.env.DB.prepare(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`).bind(id).first();
  return c.json({ company });
});

companies.post("/:id/activate", async (c) => {
  const id = c.req.param("id");
  if (!(await requireCompanyOwnership(c, id))) return c.json({ error: "Not found" }, 404);
  await setActiveCompany(c.env, c.get("session").sessionId, id);
  return c.json({ ok: true });
});

// Logo upload: raw image bytes in the request body, Content-Type preserved.
companies.put("/:id/logo", async (c) => {
  const id = c.req.param("id");
  if (!(await requireCompanyOwnership(c, id))) return c.json({ error: "Not found" }, 404);

  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return c.json({ error: "Logo must be an image" }, 400);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) {
    return c.json({ error: "Logo must be under 2MB" }, 400);
  }

  await c.env.DB
    .prepare("UPDATE companies SET logo_data = ?, logo_content_type = ? WHERE id = ?")
    .bind(bytes, contentType, id)
    .run();

  return c.json({ ok: true, logo_url: `/api/companies/${id}/logo` });
});

companies.get("/:id/logo", async (c) => {
  const id = c.req.param("id");
  const company = await c.env.DB
    .prepare("SELECT logo_data, logo_content_type FROM companies WHERE id = ?")
    .bind(id)
    .first<{ logo_data: ArrayBuffer | null; logo_content_type: string | null }>();
  if (!company?.logo_data) return c.notFound();

  return new Response(company.logo_data, {
    headers: {
      "Content-Type": company.logo_content_type ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

export default companies;
