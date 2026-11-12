export const LEDGER_SUFFIX = "/.fix-findings/ledger.json";
export const MAX_ROUNDS = 3;
/** A finding raised this many times has come back twice: the first raising plus two returns. */
export const MAX_RAISINGS = 3;

export type Finding = { id: string; state: string; rounds: number[] };
export type Ledger = { status: string; round: number; findings: Finding[] };

/**
 * Whether the ledger names this session: a ledger left by another session never holds this one back.
 * Matches the raw text, so a ledger this session broke still gets its repair prompt.
 */
export function ownedBy(text: string, sessionId: string): boolean {
  return text.includes(JSON.stringify(sessionId));
}

function isFinding(f: unknown): f is Finding {
  if (!f || typeof f !== "object") return false;
  const { id, state, rounds } = f as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof state === "string" &&
    Array.isArray(rounds) &&
    rounds.every((r) => typeof r === "number")
  );
}

/** The ledger the text holds, or null when it is not one. */
export function parseLedger(text: string): Ledger | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { status, round, findings } = v as Record<string, unknown>;
  if (
    typeof status !== "string" ||
    typeof round !== "number" ||
    !Array.isArray(findings)
  )
    return null;
  if (!findings.every(isFinding)) return null;
  return { status, round, findings };
}

/** What to tell a model that tries to end while its loop runs; undefined lets it end. */
export function reprompt(ledger: Ledger | null): string | undefined {
  if (!ledger)
    return `The convergence ledger does not match the schema in the fix-findings skill. Repair it, then continue the loop.`;
  if (ledger.status !== "running") return undefined;

  const end = `Set status to "stopped" with a stopReason, then report.`;
  const returned = ledger.findings.filter(
    (f) => f.rounds.length >= MAX_RAISINGS,
  );
  if (returned.length > 0)
    return `Finding ${returned.map((f) => f.id).join(", ")} has come back twice, so the loop must stop. ${end}`;

  if (ledger.round > MAX_ROUNDS)
    return `The loop has passed its ${MAX_ROUNDS} rounds. ${end}`;
  const open = ledger.findings.filter((f) => f.state === "open");
  const at = `Round ${ledger.round} of ${MAX_ROUNDS}`;
  if (open.length > 0)
    return `${at}: ${open.map((f) => f.id).join(", ")} still open and the ledger says running. Continue the loop, or, if it cannot go on, set status to "stopped" with a stopReason.`;
  return `${at}: no finding is open but the ledger says running. Run the next review, then set status to "converged" if it raises nothing material; or set "stopped" with a stopReason.`;
}
