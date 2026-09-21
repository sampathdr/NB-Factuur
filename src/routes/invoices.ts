import { Hono } from "hono";
import { Company, Client, Env, Invoice, InvoiceItem, InvoiceItemInput, VatScheme } from "../types";
import { AuthedVars, requireAuth, requireCompanyOwnership } from "../lib/middleware";
import { newId, amountToCents, todayIso } from "../lib/util";
import { buildInvoicePdf } from "../lib/pdf";

const invoices = new Hono<{ Bindings: Env; Variables: AuthedVars }>();
invoices.use("*", requireAuth);

interface CreateInvoiceBody {
  company_id: string;
  client_id: string;
  invoice_date?: string;
  delivery_date: string;
  currency?: string;
  vat_scheme?: VatScheme;
  numbering_mode?: "auto" | "manual";
  manual_invoice_number?: string;
  notes?: string;
  items: InvoiceItemInput[];
}

async function nextAutoInvoiceNumber(env: Env, company: Company): Promise<string> {
  const year = new Date().getFullYear();
  const seq = company.next_invoice_seq;
  await env.DB
    .prepare("UPDATE companies SET next_invoice_seq = next_invoice_seq + 1 WHERE id = ?")
    .bind(company.id)
    .run();
  return `${company.invoice_prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

function calcTotals(items: InvoiceItemInput[], vatScheme: VatScheme) {
  let subtotal = 0;
  let vatTotal = 0;
  const lines: InvoiceItem[] = items.map((item, i) => {
    const lineTotal = Math.round(item.quantity * item.unit_price);
    subtotal += lineTotal;
    const effectiveRate = vatScheme === "standard" ? item.vat_rate : 0;
    vatTotal += Math.round(lineTotal * effectiveRate);
    return {
      id: newId(),
      invoice_id: "", // filled in after invoice id is known
      position: i,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: effectiveRate,
      line_total: lineTotal,
    };
  });
  return { subtotal, vatTotal, total: subtotal + vatTotal, lines };
}

invoices.get("/", async (c) => {
  const companyId = c.req.query("company_id");
  if (!companyId) return c.json({ error: "company_id is required" }, 400);
  if (!(await requireCompanyOwnership(c, companyId))) return c.json({ error: "Not found" }, 404);

  const { results } = await c.env.DB
    .prepare(
      `SELECT i.*, cl.name AS client_name
       FROM invoices i JOIN clients cl ON cl.id = i.client_id
       WHERE i.company_id = ? ORDER BY i.created_at DESC`
    )
    .bind(companyId)
    .all();
  return c.json({ invoices: results });
});

invoices.post("/", async (c) => {
  const body = await c.req.json<CreateInvoiceBody>();
  if (!(await requireCompanyOwnership(c, body.company_id))) {
    return c.json({ error: "Not found" }, 404);
  }
  if (!body.items || body.items.length === 0) {
    return c.json({ error: "At least one line item is required" }, 400);
  }
  if (!body.delivery_date) {
    return c.json({ error: "delivery_date is required" }, 400);
  }

  const company = await c.env.DB
    .prepare("SELECT * FROM companies WHERE id = ?")
    .bind(body.company_id)
    .first<Company>();
  if (!company) return c.json({ error: "Company not found" }, 404);

  const client = await c.env.DB
    .prepare("SELECT * FROM clients WHERE id = ? AND company_id = ?")
    .bind(body.client_id, body.company_id)
    .first<Client>();
  if (!client) return c.json({ error: "Client not found" }, 404);

  const vatScheme: VatScheme = body.vat_scheme ?? company.vat_scheme;
  if (vatScheme === "reverse_charge" && !client.vat_number) {
    return c.json(
      { error: "Reverse-charge invoices require the client's VAT number" },
      400
    );
  }

  const numberingMode = body.numbering_mode === "manual" ? "manual" : "auto";
  let invoiceNumber: string;
  if (numberingMode === "manual") {
    invoiceNumber = String(body.manual_invoice_number ?? "").trim();
    if (!invoiceNumber) {
      return c.json({ error: "manual_invoice_number is required when numbering_mode is 'manual'" }, 400);
    }
    const dup = await c.env.DB
      .prepare("SELECT id FROM invoices WHERE company_id = ? AND invoice_number = ?")
      .bind(company.id, invoiceNumber)
      .first();
    if (dup) return c.json({ error: "That invoice number is already in use" }, 409);
  } else {
    invoiceNumber = await nextAutoInvoiceNumber(c.env, company);
  }

  // Normalize items into integer cents server-side; never trust client-computed totals.
  const normalizedItems: InvoiceItemInput[] = body.items.map((it) => ({
    description: String(it.description ?? "").trim(),
    quantity: Number(it.quantity) || 0,
    unit_price:
      typeof it.unit_price === "number" ? Math.round(it.unit_price) : amountToCents(it.unit_price as any),
    vat_rate: Number(it.vat_rate) || 0,
  }));

  const { subtotal, vatTotal, total, lines } = calcTotals(normalizedItems, vatScheme);

  const invoiceId = newId();
  const invoiceDate = body.invoice_date || todayIso();

  await c.env.DB
    .prepare(
      `INSERT INTO invoices
        (id, company_id, client_id, invoice_number, numbering_mode, invoice_date, delivery_date,
         currency, vat_scheme, notes, subtotal_amount, vat_amount, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      invoiceId,
      company.id,
      client.id,
      invoiceNumber,
      numberingMode,
      invoiceDate,
      body.delivery_date,
      body.currency ?? company.default_currency,
      vatScheme,
      body.notes ?? null,
      subtotal,
      vatTotal,
      total
    )
    .run();

  const stmts = lines.map((line) =>
    c.env.DB
      .prepare(
        `INSERT INTO invoice_items (id, invoice_id, position, description, quantity, unit_price, vat_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(line.id, invoiceId, line.position, line.description, line.quantity, line.unit_price, line.vat_rate, line.line_total)
  );
  await c.env.DB.batch(stmts);

  const invoice = await c.env.DB.prepare("SELECT * FROM invoices WHERE id = ?").bind(invoiceId).first();
  return c.json({ invoice }, 201);
});

async function loadInvoiceBundle(
  c: import("hono").Context<{ Bindings: Env; Variables: AuthedVars }>,
  invoiceId: string
) {
  const invoice = await c.env.DB
    .prepare("SELECT * FROM invoices WHERE id = ?")
    .bind(invoiceId)
    .first<Invoice>();
  if (!invoice) return null;
  if (!(await requireCompanyOwnership(c, invoice.company_id))) return null;

  const company = await c.env.DB
    .prepare("SELECT * FROM companies WHERE id = ?")
    .bind(invoice.company_id)
    .first<Company>();
  const client = await c.env.DB
    .prepare("SELECT * FROM clients WHERE id = ?")
    .bind(invoice.client_id)
    .first<Client>();
  const { results: items } = await c.env.DB
    .prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position")
    .bind(invoiceId)
    .all<InvoiceItem>();

  return { invoice, company, client, items };
}

invoices.get("/:id", async (c) => {
  const bundle = await loadInvoiceBundle(c, c.req.param("id"));
  if (!bundle) return c.json({ error: "Not found" }, 404);
  return c.json(bundle);
});

invoices.get("/:id/pdf", async (c) => {
  const bundle = await loadInvoiceBundle(c, c.req.param("id"));
  if (!bundle) return c.json({ error: "Not found" }, 404);
  const { invoice, company, client, items } = bundle;
  if (!company || !client) return c.json({ error: "Invoice data incomplete" }, 500);

  let logoBytes: { bytes: ArrayBuffer; contentType: string } | null = null;
  if (company.logo_key) {
    const obj = await c.env.LOGOS.get(company.logo_key);
    if (obj) {
      logoBytes = {
        bytes: await obj.arrayBuffer(),
        contentType: obj.httpMetadata?.contentType ?? "image/png",
      };
    }
  }

  const pdfBytes = await buildInvoicePdf({ company, client, invoice, items, logoBytes });

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
    },
  });
});

export default invoices;
