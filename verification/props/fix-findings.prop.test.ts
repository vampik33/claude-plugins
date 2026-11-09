/**
 * Property tests for fix-findings/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  MAX_RAISINGS,
  MAX_ROUNDS,
  ownedBy,
  parseLedger,
  reprompt,
  type Ledger,
} from "../../plugins/fix-findings/hooks/core.ts";

const finding = fc.record({
  id: fc.string({ minLength: 1 }),
  state: fc.constantFrom("open", "fixed", "invalid"),
  rounds: fc.array(fc.integer({ min: 1, max: 9 }), {
    minLength: 1,
    maxLength: 5,
  }),
});
const ledger = fc.record({
  status: fc.constantFrom("running", "converged", "stopped"),
  round: fc.integer({ min: 1, max: 9 }),
  findings: fc.array(finding, { maxLength: 6 }),
});

describe("parseLedger", () => {
  test("never throws, and returns null or a ledger", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        const l = parseLedger(text);
        expect(l === null || Array.isArray(l.findings)).toBe(true);
      }),
    );
  });

  test("reads back what the schema allows, ignoring extra fields", () => {
    fc.assert(
      fc.property(ledger, (l) => {
        expect(
          parseLedger(JSON.stringify({ ...l, base: "abc", stopReason: null })),
        ).toEqual(l);
      }),
    );
  });
});

describe("ownedBy", () => {
  test("a ledger belongs to the session it names, and to no other", () => {
    fc.assert(
      fc.property(ledger, fc.uuid(), fc.uuid(), (l, me, other) => {
        fc.pre(me !== other);
        const text = JSON.stringify({ sessionId: me, ...l });
        expect(ownedBy(text, me)).toBe(true);
        expect(ownedBy(text, other)).toBe(false);
      }),
    );
  });

  test("an id that is only part of the named one does not match", () => {
    expect(ownedBy('{"sessionId":"abc-def"}', "abc")).toBe(false);
  });
});

describe("reprompt", () => {
  test("a finished loop always ends, and a running one never does", () => {
    fc.assert(
      fc.property(ledger, (l: Ledger) => {
        expect(reprompt(l) === undefined).toBe(l.status !== "running");
      }),
    );
  });

  test("a finding raised three times orders a stop, whatever else holds", () => {
    fc.assert(
      fc.property(ledger, (l: Ledger) => {
        const back = {
          id: "BACK",
          state: "fixed",
          rounds: Array.from({ length: MAX_RAISINGS }, (_, i) => i + 1),
        };
        const text = reprompt({
          ...l,
          status: "running",
          findings: [...l.findings, back],
        });
        expect(text).toContain("BACK");
        expect(text).toContain('"stopped"');
      }),
    );
  });

  test("past its rounds the loop may not continue", () => {
    const text = reprompt({
      status: "running",
      round: MAX_ROUNDS + 1,
      findings: [],
    });
    expect(text).toContain('"stopped"');
    expect(text).not.toContain("Continue");
  });

  test("an unreadable ledger asks for a repair", () => {
    expect(reprompt(null)).toContain("Repair");
  });
});
