-- NB-Factuur database schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_company_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A "company" is one tenant / one Dutch business entity issuing invoices.
-- A single Google user can own multiple companies (e.g. a bookkeeper or
-- someone running two businesses), which is what makes this multi-tenant.
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  address_line1 TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Nederland',
  kvk_number TEXT NOT NULL,
  vat_number TEXT,               -- required unless vat_scheme = 'kor'
  vat_scheme TEXT NOT NULL DEFAULT 'standard', -- standard | kor | reverse_charge_default
  iban TEXT,
  bic TEXT,
  email TEXT,
  phone TEXT,
  logo_key TEXT,                 -- R2 object key
  default_currency TEXT NOT NULL DEFAULT 'EUR',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  next_invoice_seq INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_user_id);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  address_line1 TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Nederland',
  vat_number TEXT,        -- for EU B2B / reverse-charge invoices
  kvk_number TEXT,
  email TEXT,
  is_eu_business INTEGER NOT NULL DEFAULT 0, -- 1 = eligible for reverse-charge
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  invoice_number TEXT NOT NULL,
  numbering_mode TEXT NOT NULL DEFAULT 'auto', -- auto | manual
  invoice_date TEXT NOT NULL,       -- ISO date
  delivery_date TEXT NOT NULL,      -- ISO date, required by Belastingdienst
  currency TEXT NOT NULL DEFAULT 'EUR',
  vat_scheme TEXT NOT NULL DEFAULT 'standard', -- standard | kor | reverse_charge
  notes TEXT,
  subtotal_amount INTEGER NOT NULL,  -- cents, excl VAT
  vat_amount INTEGER NOT NULL,       -- cents
  total_amount INTEGER NOT NULL,     -- cents, incl VAT
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price INTEGER NOT NULL,   -- cents, excl VAT
  vat_rate REAL NOT NULL,        -- 0.21, 0.09, 0 (or 0 for KOR/reverse-charge)
  line_total INTEGER NOT NULL    -- cents, excl VAT (quantity * unit_price)
);

CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
