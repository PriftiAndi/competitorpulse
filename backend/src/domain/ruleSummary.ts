import type { FieldChange } from "../db/schema.js";
import type { NormalizedListing } from "../source/normalize.js";

/**
 * Deterministic summary for the one change that is both the most common and
 * the easiest to describe: the price moved and nothing else did. Saves an LLM
 * call per price change, which at production volume is most of the budget.
 * Returns null when the change set is anything else.
 */
export function priceOnlySummary(
  changes: FieldChange[],
  before: NormalizedListing,
  after: NormalizedListing,
): string | null {
  if (changes.length !== 1 || changes[0]?.field !== "price") return null;
  const from = changes[0].before ?? "unknown";
  const to = changes[0].after ?? "unknown";

  const a = before.priceParts;
  const b = after.priceParts;
  const comparable = a && b && a.currency === b.currency && a.period === b.period && a.amount !== b.amount;
  if (comparable) {
    const pct = a.amount > 0 ? Math.round((Math.abs(b.amount - a.amount) / a.amount) * 100) : null;
    const direction = b.amount > a.amount ? "rose" : "dropped";
    return pct !== null ? `Price ${direction} from ${from} to ${to} (${pct}%).` : `Price ${direction} from ${from} to ${to}.`;
  }
  if (b && b.amount === 0) return `The listing is now free (was ${from}).`;
  if (a && a.amount === 0) return `The listing is no longer free: now ${to}.`;
  return `Price changed from ${from} to ${to}.`;
}
