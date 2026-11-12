/**
 * Turns the noisy, format-shifting listing payload of the source into a canonical
 * representation that can be compared between polls.
 *
 * Everything the product manager does not care about is dropped here: unknown
 * fields, request ids, viewer counts, promo banners, key order, whitespace and
 * HTML-entity differences, and the many ways of writing the same price.
 */

export const LISTING_FIELDS = ["title", "tagline", "price", "description"] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

export type PricePeriod = "month" | "year" | "seat_month";

export type PriceParts = {
  amount: number;
  currency: string | null; // ISO code; null for "Free"
  period: PricePeriod | null; // null for "Free"
};

export type NormalizedListing = {
  title: string | null;
  tagline: string | null;
  description: string | null;
  /** Canonical display string, e.g. "$29/mo", "€8/seat/mo", "Free". */
  price: string | null;
  /** Parsed price, null when the text could not be parsed (then `price` is the cleaned raw text). */
  priceParts: PriceParts | null;
  /** Fields the source did not provide (missing, empty or null) in this response. */
  missingFields: ListingField[];
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function normalizeText(raw: string): string {
  return raw
    .replace(/&(amp|nbsp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const SYMBOL_BY_CURRENCY: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

const FREE_RE = /^(free( forever)?|(\$|€|£)?0+(\.0+)?\s*(\/|per)?\s*(mo|month|monthly)?)$/i;

/**
 * Parses price texts such as "$29/mo", "$29 / month", "USD 29 per month",
 * "$29.00/mo", "€8/seat/mo", "EUR 96 per year", "Free", "$0/mo".
 * Returns null when the text is not understood; callers then fall back to
 * comparing the cleaned text.
 */
export function parsePrice(raw: string): PriceParts | null {
  const text = normalizeText(raw);
  if (text === "") return null;
  if (FREE_RE.test(text)) return { amount: 0, currency: null, period: null };

  const m = text.match(/^(?:([$€£])\s*|([A-Za-z]{3})\s+)(\d+(?:[.,]\d{1,2})?)\s*(.*)$/);
  if (!m) return null;
  const symbol = m[1];
  const code = m[2];
  const amountText = m[3];
  const rest = (m[4] ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  const currency = symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : (code?.toUpperCase() ?? null);
  const amount = Number(amountText!.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  if (amount === 0) return { amount: 0, currency: null, period: null };

  let period: PricePeriod | null = null;
  if (rest !== "") {
    const words = rest.replace(/[/]/g, " ").replace(/\bper\b/g, " ").split(/\s+/).filter(Boolean);
    const seat = words.includes("seat") || words.includes("user");
    const yearly = words.some((w) => ["yr", "year", "annual", "annually", "y"].includes(w));
    const monthly = words.some((w) => ["mo", "month", "monthly", "m"].includes(w));
    const known = words.every((w) =>
      ["seat", "user", "yr", "year", "annual", "annually", "y", "mo", "month", "monthly", "m"].includes(w),
    );
    if (!known || (yearly && monthly)) return null;
    if (yearly) period = "year";
    else if (monthly) period = seat ? "seat_month" : "month";
    else return null; // e.g. "/seat" without a period
  }
  return { amount, currency, period };
}

export function formatPrice(parts: PriceParts): string {
  if (parts.amount === 0) return "Free";
  const amount = Number.isInteger(parts.amount) ? String(parts.amount) : parts.amount.toFixed(2);
  const symbol = parts.currency ? SYMBOL_BY_CURRENCY[parts.currency] : undefined;
  const money = symbol ? `${symbol}${amount}` : parts.currency ? `${parts.currency} ${amount}` : amount;
  const period =
    parts.period === "month" ? "/mo" : parts.period === "year" ? "/yr" : parts.period === "seat_month" ? "/seat/mo" : "";
  return `${money}${period}`;
}

export function samePrice(a: NormalizedListing, b: NormalizedListing): boolean {
  if (a.priceParts && b.priceParts) {
    return (
      a.priceParts.amount === b.priceParts.amount &&
      a.priceParts.currency === b.priceParts.currency &&
      a.priceParts.period === b.priceParts.period
    );
  }
  return a.price === b.price;
}

function readField(payload: Record<string, unknown>, field: ListingField): string | null {
  const value = payload[field];
  if (typeof value !== "string") return null;
  const cleaned = normalizeText(value);
  return cleaned === "" ? null : cleaned;
}

/** Normalises a raw JSON payload from the source. Never throws on odd shapes. */
export function normalizeListing(payload: unknown): NormalizedListing {
  const record =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const missingFields: ListingField[] = [];

  const title = readField(record, "title");
  const tagline = readField(record, "tagline");
  const description = readField(record, "description");
  const priceText = readField(record, "price");
  if (title === null) missingFields.push("title");
  if (tagline === null) missingFields.push("tagline");
  if (priceText === null) missingFields.push("price");
  if (description === null) missingFields.push("description");

  const priceParts = priceText === null ? null : parsePrice(priceText);
  const price = priceText === null ? null : priceParts ? formatPrice(priceParts) : priceText;

  return { title, tagline, description, price, priceParts, missingFields };
}
