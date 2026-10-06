/**
 * Differential tests: the TypeScript the mods run against the Lean models in
 * ../lean, which carry the proofs. Random inputs go to both; any disagreement
 * means the proofs are about something other than the shipped code.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";

import {
  applyStatuses,
  endShell,
  trim,
} from "../../plugins/fleet/hooks/core.ts";
import { trimJobs } from "../../plugins/codex-review/hooks/core.ts";
import {
  decideTtl,
  observeTtl,
  type Sample,
} from "../../plugins/continuity/hooks/ttl.ts";
import { cap, turnEnd } from "../../plugins/prompt-clock/hooks/core.ts";

const ORACLE = join(import.meta.dir, "../lean/.lake/build/bin/oracle");
const RUNS = 2000;

/** Answers every request in one oracle process. */
function oracle(requests: { fn: string; args: unknown }[]): unknown[] {
  if (!existsSync(ORACLE))
    throw new Error(
      `no oracle: run \`lake build\` in ${join(import.meta.dir, "../lean")}`,
    );
  const out = Bun.spawnSync([ORACLE], {
    stdin: new TextEncoder().encode(
      requests.map((r) => JSON.stringify(r)).join("\n") + "\n",
    ),
  });
  const lines = out.stdout.toString().trim().split("\n");
  expect(lines.length).toBe(requests.length);
  return lines.map((l) => {
    const r = JSON.parse(l);
    if ("error" in r) throw new Error(`oracle: ${r.error}`);
    return r.ok;
  });
}

/** Runs `prop`'s cases through TS, then all of them through Lean at once, and compares. */
function differential<T>(
  fn: string,
  arb: fc.Arbitrary<T>,
  ts: (input: T) => unknown,
  args: (input: T) => unknown,
  normalize: (v: any) => unknown = (v) => v,
) {
  const inputs = fc.sample(arb, RUNS);
  const lean = oracle(inputs.map((i) => ({ fn, args: args(i) })));
  inputs.forEach((input, i) => {
    const want = normalize(lean[i]);
    const got = normalize(ts(input));
    if (!Bun.deepEquals(got, want))
      throw new Error(
        `${fn} disagrees on ${JSON.stringify(args(input))}\n  ts:   ${JSON.stringify(got)}\n  lean: ${JSON.stringify(want)}`,
      );
  });
}

const STATUSES = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "killed",
];
const status = fc.constantFrom(...STATUSES);
const id = fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h");

/** Items with distinct ids, as the mods keep them. */
const items = (st: fc.Arbitrary<string>) =>
  fc
    .uniqueArray(
      fc.record({
        id,
        status: st,
        startedAt: fc.nat(1000),
        endedAt: fc.option(fc.nat(1000), { nil: undefined }),
      }),
      { selector: (i) => i.id, maxLength: 8 },
    )
    .map((l) =>
      l.map(({ endedAt, ...i }) =>
        endedAt === undefined ? i : { ...i, endedAt },
      ),
    );

/** `endedAt` dropped when absent, so `{endedAt: undefined}` and `{}` compare equal. */
const plain = (l: any[]) =>
  l.map(({ id, status, endedAt }) =>
    endedAt === undefined ? { id, status } : { id, status, endedAt },
  );

describe("Lean ≡ TypeScript", () => {
  test("fleet trim", () =>
    differential(
      "trim",
      fc.record({ items: items(status), keep: fc.nat(10) }),
      ({ items, keep }) => trim(items as any, keep).map((i) => i.id),
      ({ items, keep }) => ({ kind: "fleet", items, keep }),
    ));

  test("codex-review trimJobs", () =>
    differential(
      "trim",
      fc.record({
        items: items(fc.constantFrom("running", "completed", "failed")),
        keep: fc.nat(6),
      }),
      ({ items, keep }) => trimJobs(items as any, keep).map((j) => j.id),
      ({ items, keep }) => ({ kind: "codex", items, keep }),
    ));

  test("fleet applyStatuses", () =>
    differential(
      "applyStatuses",
      fc.record({
        agents: items(status),
        statuses: fc.dictionary(id, status, { maxKeys: 8 }),
        now: fc.nat(2000),
      }),
      ({ agents, statuses, now }) => {
        const r = applyStatuses(agents as any, statuses, now);
        return { agents: r.agents, ended: r.ended };
      },
      (i) => i,
      (r) => ({ agents: plain(r.agents), ended: plain(r.ended) }),
    ));

  test("fleet endShell (ids may repeat)", () =>
    differential(
      "endShell",
      fc.record({
        shells: fc.array(
          fc.record({
            id: fc.constantFrom("a", "b", "c"),
            status,
            startedAt: fc.nat(10),
          }),
          { maxLength: 6 },
        ),
        id: fc.constantFrom("a", "b", "c", "z"),
        status,
        now: fc.nat(2000),
      }),
      ({ shells, id, status, now }) => endShell(shells as any, id, status, now),
      (i) => i,
      (r) => ({
        shells: plain(r.shells),
        ended: r.ended ? plain([r.ended])[0] : null,
      }),
    ));

  const envValue = fc.constantFrom(
    undefined,
    "1",
    "0",
    "true",
    "TRUE",
    "True",
    "yes",
    "5m",
    "1h",
    "",
  );
  test("continuity decideTtl", () =>
    differential(
      "decideTtl",
      fc.record({
        option: fc.constantFrom(undefined, "auto", "5m", "1h", "2h"),
        env: fc.record({
          enable1h: envValue,
          force5m: envValue,
          ttlVar: envValue,
        }),
        setting: fc.constantFrom(undefined, "5m", "1h", "10m"),
        account: fc.constantFrom(undefined, "subscription", "credits", "other"),
      }),
      ({ option, env, setting, account }) =>
        decideTtl(option, env, setting, account as any),
      (i) => i,
    ));

  // token counts near the 0.5 and 0.7 ratios, where float and exact arithmetic can part
  const tokens = fc.oneof(
    fc.nat(50),
    fc.nat(2_000_000),
    fc.nat(200_000).map((m) => m * 10),
  );
  const sample = (model: fc.Arbitrary<string>): fc.Arbitrary<Sample> =>
    fc.record({
      model,
      startedAt: fc.integer({ min: 0, max: 5_000_000 }),
      read: tokens,
      write: tokens,
      fresh: tokens,
    });
  const ratioPair = fc
    .tuple(
      fc.nat(300_000),
      fc.constantFrom(5, 7),
      fc.integer({ min: 300_000, max: 4_000_000 }),
    )
    .map(([m, r, gap]) => {
      // prev's prompt is 10m tokens; cur's prompt sits exactly on r/10 of it
      const prev: Sample = {
        model: "x",
        startedAt: 0,
        read: 10 * m,
        write: 0,
        fresh: 0,
      };
      const cur: Sample =
        r === 5
          ? { model: "x", startedAt: gap, read: 5 * m, write: 1, fresh: 0 }
          : { model: "x", startedAt: gap, read: 0, write: 7 * m, fresh: 0 };
      return { prev, cur, known: undefined };
    });
  test("continuity observeTtl", () =>
    differential(
      "observeTtl",
      fc.oneof(
        fc.record({
          prev: fc.option(sample(fc.constantFrom("a", "b")), {
            nil: undefined,
          }),
          cur: sample(fc.constantFrom("a", "b")),
          known: fc.constantFrom(undefined, "5m", "1h"),
        }),
        ratioPair,
      ),
      ({ prev, cur, known }) => observeTtl(prev, cur, known as any) ?? null,
      ({ prev, cur, known }) => ({
        prev: prev ?? null,
        cur,
        known: known ?? null,
      }),
    ));

  test("prompt-clock turnEnd", () =>
    differential(
      "turnEnd",
      fc.record({
        turns: fc.dictionary(fc.nat(10_000).map(String), fc.nat(1_000_000), {
          maxKeys: 8,
        }),
        durationMs: fc.nat(10_000),
      }),
      ({ turns, durationMs }) => turnEnd(turns, durationMs) ?? null,
      ({ turns, durationMs }) => ({ turns: Object.entries(turns), durationMs }),
    ));

  test("prompt-clock cap", () =>
    differential(
      "cap",
      fc.record({
        record: fc.dictionary(fc.string({ maxLength: 3 }), fc.nat(20), {
          maxKeys: 10,
        }),
        keep: fc.nat(10),
      }),
      ({ record, keep }) => Object.keys(cap(record, keep)),
      ({ record, keep }) => ({ entries: Object.entries(record), keep }),
      (keys: string[]) => [...keys].sort(),
    ));
});
