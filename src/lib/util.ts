export function newId(): string {
  return crypto.randomUUID();
}

export function newOpaqueToken(): string {
  // Higher-entropy opaque token for session cookies.
  return crypto.randomUUID() + crypto.randomUUID();
}

/** Format an integer amount in cents as a currency string, e.g. 1234 -> "12.34". */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parse a user-entered decimal amount (e.g. "12.34") into integer cents. */
export function amountToCents(amount: number | string): number {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
};

export function formatMoney(cents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + " ";
  return `${symbol} ${centsToAmount(cents)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
