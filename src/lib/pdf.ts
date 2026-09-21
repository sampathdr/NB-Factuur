import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import { Company, Client, Invoice, InvoiceItem } from "../types";
import { centsToAmount } from "./util";

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

interface BuildPdfInput {
  company: Company;
  client: Client;
  invoice: Invoice;
  items: InvoiceItem[];
  logoBytes?: { bytes: ArrayBuffer; contentType: string } | null;
}

function currencySymbol(currency: string): string {
  const map: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
  };
  return map[currency] ?? currency + " ";
}

export async function buildInvoicePdf(input: BuildPdfInput): Promise<Uint8Array> {
  const { company, client, invoice, items } = input;
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sym = currencySymbol(invoice.currency);

  let y = PAGE_HEIGHT - MARGIN;

  // --- Logo (top right) ---
  if (input.logoBytes) {
    try {
      const img = input.logoBytes.contentType.includes("png")
        ? await doc.embedPng(input.logoBytes.bytes)
        : await doc.embedJpg(input.logoBytes.bytes);
      const maxW = 140;
      const maxH = 60;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: PAGE_WIDTH - MARGIN - w,
        y: y - h,
        width: w,
        height: h,
      });
    } catch {
      // If the logo can't be embedded (unsupported format), skip it silently.
    }
  }

  // --- Company info (top left) ---
  const companyDisplayName = company.trade_name || company.legal_name;
  y = drawText(page, companyDisplayName, MARGIN, y, bold, 14);
  y = drawText(page, company.address_line1, MARGIN, y - 4, font, 10);
  y = drawText(page, `${company.postal_code} ${company.city}`, MARGIN, y, font, 10);
  y = drawText(page, company.country, MARGIN, y, font, 10);
  if (company.email) y = drawText(page, company.email, MARGIN, y, font, 10);
  if (company.phone) y = drawText(page, company.phone, MARGIN, y, font, 10);

  y -= 20;

  // --- Title ---
  y = drawText(page, "FACTUUR / INVOICE", MARGIN, y, bold, 18);
  y -= 10;

  // --- Invoice meta (two columns) ---
  const metaTop = y;
  const leftX = MARGIN;
  const rightX = PAGE_WIDTH / 2;

  let ly = metaTop;
  ly = drawLabelValue(page, "Factuurnummer / Invoice no.", invoice.invoice_number, leftX, ly, font, bold);
  ly = drawLabelValue(page, "Factuurdatum / Invoice date", invoice.invoice_date, leftX, ly, font, bold);
  ly = drawLabelValue(page, "Leverdatum / Delivery date", invoice.delivery_date, leftX, ly, font, bold);

  let ry = metaTop;
  ry = drawLabelValue(page, "KvK-nummer", company.kvk_number, rightX, ry, font, bold);
  ry = drawLabelValue(
    page,
    "BTW-nummer / VAT no.",
    company.vat_scheme === "kor" ? "n.v.t. (KOR)" : company.vat_number ?? "-",
    rightX,
    ry,
    font,
    bold
  );
  if (company.iban) {
    ry = drawLabelValue(page, "IBAN", company.iban, rightX, ry, font, bold);
  }

  y = Math.min(ly, ry) - 20;

  // --- Bill to ---
  y = drawText(page, "Factuuradres / Bill to", MARGIN, y, bold, 11);
  y = drawText(page, client.name, MARGIN, y - 4, font, 10);
  y = drawText(page, client.address_line1, MARGIN, y, font, 10);
  y = drawText(page, `${client.postal_code} ${client.city}`, MARGIN, y, font, 10);
  y = drawText(page, client.country, MARGIN, y, font, 10);
  if (client.vat_number) y = drawText(page, `BTW-nummer: ${client.vat_number}`, MARGIN, y, font, 10);

  y -= 25;

  // --- Line items table ---
  const colX = {
    desc: MARGIN,
    qty: MARGIN + 260,
    price: MARGIN + 320,
    vat: MARGIN + 400,
    total: MARGIN + 450,
  };
  const tableRight = PAGE_WIDTH - MARGIN;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: tableRight, y },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 14;
  drawText(page, "Omschrijving / Description", colX.desc, y, bold, 9);
  drawText(page, "Aantal", colX.qty, y, bold, 9);
  drawText(page, "Prijs", colX.price, y, bold, 9);
  drawText(page, "BTW%", colX.vat, y, bold, 9);
  drawText(page, "Totaal", colX.total, y, bold, 9);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: tableRight, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  y -= 14;

  for (const item of items) {
    if (y < 100) break; // simple v1: single-page invoices
    drawText(page, truncate(item.description, 45), colX.desc, y, font, 9);
    drawText(page, String(item.quantity), colX.qty, y, font, 9);
    drawText(page, `${sym}${centsToAmount(item.unit_price)}`, colX.price, y, font, 9);
    drawText(page, `${Math.round(item.vat_rate * 100)}%`, colX.vat, y, font, 9);
    drawText(page, `${sym}${centsToAmount(item.line_total)}`, colX.total, y, font, 9);
    y -= 16;
  }

  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: tableRight, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  y -= 18;

  // --- Totals ---
  const totalsLabelX = colX.vat - 20;
  y = drawLabelValue(
    page,
    "Subtotaal excl. BTW",
    `${sym}${centsToAmount(invoice.subtotal_amount)}`,
    totalsLabelX,
    y,
    font,
    font,
    true
  );

  if (invoice.vat_scheme === "standard") {
    y = drawLabelValue(
      page,
      "BTW",
      `${sym}${centsToAmount(invoice.vat_amount)}`,
      totalsLabelX,
      y,
      font,
      font,
      true
    );
  }

  y = drawLabelValue(
    page,
    "Totaal",
    `${sym}${centsToAmount(invoice.total_amount)}`,
    totalsLabelX,
    y,
    bold,
    bold,
    true
  );

  y -= 20;

  // --- Scheme-specific compliance notes ---
  if (invoice.vat_scheme === "kor") {
    y = drawText(
      page,
      "Op deze factuur is de kleineondernemersregeling (KOR) van toepassing. Er wordt geen btw in rekening gebracht.",
      MARGIN,
      y,
      font,
      9
    );
  } else if (invoice.vat_scheme === "reverse_charge") {
    y = drawText(
      page,
      "BTW verlegd naar de afnemer (reverse charge — VAT to be accounted for by the recipient).",
      MARGIN,
      y,
      font,
      9
    );
    if (client.vat_number) {
      y = drawText(page, `BTW-nummer afnemer: ${client.vat_number}`, MARGIN, y, font, 9);
    }
  }

  if (invoice.notes) {
    y -= 14;
    y = drawText(page, invoice.notes, MARGIN, y, font, 9);
  }

  // --- Footer ---
  page.drawText(
    `${companyDisplayName} · KvK ${company.kvk_number}` +
      (company.vat_number ? ` · BTW ${company.vat_number}` : ""),
    {
      x: MARGIN,
      y: 30,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }
  );

  return doc.save();
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number): number {
  page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  return y - (size + 4);
}

function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  labelFont: PDFFont,
  valueFont: PDFFont,
  rightAlignValue = false
): number {
  page.drawText(label, { x, y, size: 9, font: labelFont, color: rgb(0.35, 0.35, 0.35) });
  const valueX = rightAlignValue ? x + 130 : x + 160;
  page.drawText(value, { x: valueX, y, size: 9, font: valueFont, color: rgb(0.1, 0.1, 0.1) });
  return y - 15;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
