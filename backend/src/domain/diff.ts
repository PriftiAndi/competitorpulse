import type { FieldChange } from "../db/schema.js";
import { samePrice, type NormalizedListing } from "../source/normalize.js";

/**
 * The last thing we know about a competitor, derived from its most recent
 * non-error snapshot.
 */
export type KnownState =
  | { kind: "listed"; listing: NormalizedListing }
  | { kind: "delisted"; lastListing: NormalizedListing | null };

export type Observation =
  | { kind: "listed"; listing: NormalizedListing }
  | { kind: "delisted" };

export type DiffResult = {
  /** The listing to store: observed fields, with missing ones carried forward. */
  effective: NormalizedListing | null;
  changed: boolean;
  changes: FieldChange[];
};

/**
 * Fills fields the source failed to send in this response with the previously
 * known values. A partial response is a source hiccup, not a product change.
 */
export function carryForward(observed: NormalizedListing, previous: NormalizedListing | null): NormalizedListing {
  if (!previous || observed.missingFields.length === 0) return observed;
  const merged: NormalizedListing = { ...observed, missingFields: [...observed.missingFields] };
  for (const field of observed.missingFields) {
    if (field === "price") {
      merged.price = previous.price;
      merged.priceParts = previous.priceParts;
    } else {
      merged[field] = previous[field];
    }
  }
  return merged;
}

/**
 * Decides whether an observation differs from the previous known state in a
 * way that matters to a product manager: availability, title, tagline, price
 * (by value, not by formatting) and description.
 */
export function diffObservation(previous: KnownState | null, observation: Observation): DiffResult {
  if (observation.kind === "delisted") {
    if (previous === null || previous.kind === "delisted") {
      return { effective: null, changed: false, changes: [] };
    }
    return {
      effective: null,
      changed: true,
      changes: [{ field: "availability", before: "listed", after: "not listed" }],
    };
  }

  const previousListing =
    previous === null ? null : previous.kind === "listed" ? previous.listing : previous.lastListing;
  const effective = carryForward(observation.listing, previousListing);

  if (previous === null) {
    return { effective, changed: false, changes: [] };
  }

  const changes: FieldChange[] = [];
  if (previous.kind === "delisted") {
    changes.push({ field: "availability", before: "not listed", after: "listed" });
  }
  if (previousListing) {
    changes.push(...compareListings(previousListing, effective));
  }
  return { effective, changed: changes.length > 0, changes };
}

export function compareListings(before: NormalizedListing, after: NormalizedListing): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.title !== after.title) changes.push({ field: "title", before: before.title, after: after.title });
  if (before.tagline !== after.tagline) changes.push({ field: "tagline", before: before.tagline, after: after.tagline });
  if (!samePrice(before, after)) changes.push({ field: "price", before: before.price, after: after.price });
  if (before.description !== after.description) {
    changes.push({ field: "description", before: before.description, after: after.description });
  }
  return changes;
}
