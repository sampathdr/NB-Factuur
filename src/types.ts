export type Env = {
  DB: D1Database;
  APP_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
};

export type VatScheme = "standard" | "kor" | "reverse_charge";
export type NumberingMode = "auto" | "manual";

export interface Company {
  id: string;
  owner_user_id: string;
  legal_name: string;
  trade_name: string | null;
  address_line1: string;
  postal_code: string;
  city: string;
  country: string;
  kvk_number: string;
  vat_number: string | null;
  vat_scheme: VatScheme;
  iban: string | null;
  bic: string | null;
  email: string | null;
  phone: string | null;
  logo_content_type: string | null;
  default_currency: string;
  invoice_prefix: string;
  next_invoice_seq: number;
  created_at: string;
}

export interface Client {
  id: string;
  company_id: string;
  name: string;
  contact_name: string | null;
  address_line1: string;
  postal_code: string;
  city: string;
  country: string;
  vat_number: string | null;
  kvk_number: string | null;
  email: string | null;
  is_eu_business: 0 | 1;
  created_at: string;
}

export interface InvoiceItemInput {
  description: string;
  quantity: number;
  unit_price: number; // in cents, excl VAT
  vat_rate: number; // 0.21, 0.09, 0
}

export interface InvoiceItem extends InvoiceItemInput {
  id: string;
  invoice_id: string;
  position: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  company_id: string;
  client_id: string;
  invoice_number: string;
  numbering_mode: NumberingMode;
  invoice_date: string;
  delivery_date: string;
  currency: string;
  vat_scheme: VatScheme;
  notes: string | null;
  subtotal_amount: number;
  vat_amount: number;
  total_amount: number;
  created_at: string;
}

export const SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
] as const;

export const VAT_RATES = [0.21, 0.09, 0] as const;
