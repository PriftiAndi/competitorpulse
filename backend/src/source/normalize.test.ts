import { describe, expect, it } from "vitest";
import { formatPrice, normalizeListing, normalizeText, parsePrice } from "./normalize.js";

describe("normalizeText", () => {
  it("collapses whitespace and decodes entities", () => {
    expect(normalizeText("  Track leads &amp; deals  in one place \n")).toBe(
      "Track leads & deals in one place",
    );
    expect(normalizeText("Simple&nbsp;CRM")).toBe("Simple CRM");
  });
});

describe("parsePrice", () => {
  it("understands the source's price variants as the same value", () => {
    const variants = ["$29/mo", "$29 / month", "USD 29 per month", "$29.00/mo"];
    for (const v of variants) {
      expect(parsePrice(v)).toEqual({ amount: 29, currency: "USD", period: "month" });
    }
  });
  it("understands per-seat and yearly prices", () => {
    expect(parsePrice("€8/seat/mo")).toEqual({ amount: 8, currency: "EUR", period: "seat_month" });
    expect(parsePrice("EUR 8 per seat per month")).toEqual({ amount: 8, currency: "EUR", period: "seat_month" });
    expect(parsePrice("€96 / year")).toEqual({ amount: 96, currency: "EUR", period: "year" });
    expect(parsePrice("CHF 10/mo")).toEqual({ amount: 10, currency: "CHF", period: "month" });
  });
  it("treats every way of saying free as the same", () => {
    for (const v of ["Free", "$0/mo", "Free forever", "€0.00 / month"]) {
      expect(parsePrice(v)).toEqual({ amount: 0, currency: null, period: null });
    }
  });
  it("returns null for text it does not understand", () => {
    expect(parsePrice("Contact sales")).toBeNull();
    expect(parsePrice("$29/seat")).toBeNull();
  });
  it("formats canonically", () => {
    expect(formatPrice({ amount: 29, currency: "USD", period: "month" })).toBe("$29/mo");
    expect(formatPrice({ amount: 12.5, currency: "GBP", period: "seat_month" })).toBe("£12.50/seat/mo");
    expect(formatPrice({ amount: 96, currency: "CHF", period: "year" })).toBe("CHF 96/yr");
    expect(formatPrice({ amount: 0, currency: null, period: null })).toBe("Free");
  });
});

describe("normalizeListing", () => {
  it("drops noise and reports missing fields", () => {
    const listing = normalizeListing({
      requestId: "abc",
      viewerCount: 12,
      promoBanner: "Spring sale",
      title: "  Acme CRM ",
      tagline: "",
      price: "USD 39 per month",
      cache: { hit: true },
    });
    expect(listing.title).toBe("Acme CRM");
    expect(listing.price).toBe("$39/mo");
    expect(listing.missingFields).toEqual(["tagline", "description"]);
  });
  it("keeps unparseable prices as cleaned text", () => {
    const listing = normalizeListing({ price: " Contact  sales " });
    expect(listing.price).toBe("Contact sales");
    expect(listing.priceParts).toBeNull();
  });
  it("survives non-object payloads", () => {
    expect(normalizeListing("<html>").missingFields).toHaveLength(4);
  });
});
