import type { FieldChange } from "../db/schema.js";
import type { ChatMessage } from "./client.js";

export function buildSummaryMessages(input: {
  competitorId: string;
  fetchedAt: Date;
  changes: FieldChange[];
}): ChatMessage[] {
  const lines = input.changes.map((c) => {
    const before = c.before === null ? "(not provided)" : JSON.stringify(c.before);
    const after = c.after === null ? "(not provided)" : JSON.stringify(c.after);
    return `- ${c.field}: ${before} -> ${after}`;
  });

  return [
    {
      role: "system",
      content:
        "You help a product manager track competitor product listings. " +
        "Given a list of field changes between two consecutive snapshots of one listing, " +
        "write a short, plain-English summary of what changed (one to three sentences). " +
        "Only describe the changes you were given, do not speculate about reasons, " +
        "and lead with the change a product manager would care about most (price, then availability, then copy).",
    },
    {
      role: "user",
      content:
        `Competitor: ${input.competitorId}\n` +
        `Observed at: ${input.fetchedAt.toISOString()}\n` +
        `Changes:\n${lines.join("\n")}`,
    },
  ];
}
