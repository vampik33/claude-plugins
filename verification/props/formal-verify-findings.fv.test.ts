/**
 * formal-verify findings: one minimal reproducer per finding, each now a regression test for its
 * fix. See .formal-verify/report-*.md.
 */
import { expect, test } from "bun:test";

import type { WatchRun } from "../../plugins/watchdog/types";
import {
  applyScan,
  evalQuoted,
  killTargets,
  matchShells,
  parseScan,
  type ScanShell,
} from "../../plugins/watchdog/hooks/core.ts";
import { extractHtml } from "../../plugins/big-picture/hooks/core.ts";
import {
  buildRawPrompt,
  companionJobId,
  readOutcome,
} from "../../plugins/codex-review/hooks/core.ts";
import type { CxJob } from "../../plugins/codex-review/types";
import { parseProgress } from "../../plugins/fleet/hooks/core.ts";
import {
  buildNote,
  compactInstructions,
  openTodos,
} from "../../plugins/continuity/hooks/core.ts";
import { parseTranscript, timeOf } from "../../plugins/prompt-clock/hooks/core.ts";

const T0 = 1_000_000_000;
const shell = (o: Partial<ScanShell>): ScanShell => ({
  pid: 100,
  pids: [100],
  ticks: 0,
  sleeping: false,
  io: 0,
  serving: false,
  ageMs: 0,
  size: 0,
  file: "/t/tasks/0.output",
  cmdline: "",
  ...o,
});
const zsh = (command: string) =>
  `zsh -c source snap && ${evalQuoted(command)} < /dev/null`;

// formal-verify finding F1: a call's quoted command found inside another call's command line
test(
  "formal-verify finding F1: call `a` takes the shell of a concurrent `a' b`",
  () => {
    const runs: WatchRun[] = [
      { id: "r0", command: "a", startedAt: T0 },
      { id: "r1", command: "a' b", startedAt: T0 + 1_000 },
    ];
    // only call 1's shell is up yet
    const m = matchShells(
      runs,
      [shell({ file: "/t/tasks/1.output", cmdline: zsh("a' b") })],
      T0 + 5_000,
    );
    expect(m.get("r0")?.file).not.toBe("/t/tasks/1.output");
  },
);

// formal-verify finding F2: two concurrent identical commands, the second one's shell up first
test("formal-verify finding F2: identical commands swap shells", () => {
  let runs: WatchRun[] = [
    { id: "r0", command: "npm test", startedAt: T0 },
    { id: "r1", command: "npm test", startedAt: T0 + 100 },
  ];
  const s0 = shell({
    pid: 2240,
    pids: [2240],
    file: "/t/tasks/0.output",
    cmdline: zsh("npm test"),
  });
  const s1 = shell({
    pid: 460,
    pids: [460],
    file: "/t/tasks/1.output",
    cmdline: zsh("npm test"),
  });
  runs = applyScan(runs, [{ ...s1, ageMs: 5_000 }], T0 + 10_000).runs;
  runs = applyScan(
    runs,
    [
      { ...s0, ageMs: 1_000 },
      { ...s1, ageMs: 15_000 },
    ],
    T0 + 20_000,
  ).runs;
  // the twin rule: neither call gets a shell while both wait, so no stop signals the other's tree
  expect(runs.map((r) => r.outputFile)).toEqual([undefined, undefined]);
  // once call 1 has ended, call 0 gets its own
  runs = runs.map((r) => (r.id === "r1" ? { ...r, endedAt: T0 + 25_000 } : r));
  runs = applyScan(runs, [{ ...s0, ageMs: 11_000 }], T0 + 30_000).runs;
  expect(runs.find((r) => r.id === "r0")?.outputFile).toBe("/t/tasks/0.output");
});

// formal-verify finding F3: parseScan keeps records with non-positive tree pids and malformed fields
test("formal-verify finding F3: a tree pid of -1 reaches kill's targets", () => {
  const parsed = parseScan("1\t1 -1\t0\t0\t0\t0\t0\t0\t/t/tasks/a.output\tc\0");
  const r = applyScan(
    [
      {
        id: "r0",
        command: "c",
        startedAt: T0,
        taskId: "t",
        outputFile: "/t/tasks/a.output",
      },
    ],
    parsed,
    T0 + 1,
  ).runs[0]!;
  // `kill -TERM -- -1 ...` signals every process the user may signal
  expect(killTargets(r)).not.toContain("-1");
});

test(
  "formal-verify finding F3: malformed numeric and flag fields are kept",
  () => {
    for (const rec of [
      "1\t1\t0\t0\t0\t0\t0\t-1\t/t/tasks/a.output\tc\0", // size -1
      "1\t1\t1.5\t0\t0\t0\t0\t0\t/t/tasks/a.output\tc\0", // ticks 1.5
      "1\t1\t0\t2\t0\t0\t0\t0\t/t/tasks/a.output\tc\0", // sleeping 2
      "1\t0\t0\t0\t0\t0\t0\t0\t/t/tasks/a.output\tc\0", // tree pid 0
    ])
      expect(parseScan(rec)).toEqual([]);
  },
);

const job = {
  id: "cx-1",
  mode: "adversarial",
  repo: "repo",
  root: "/r",
  scope: "base",
  base: "main",
  status: "completed",
  startedAt: 0,
} as CxJob;
const FENCE = /<\s*\/?\s*codex-review/gi;

// formal-verify finding F4: a fence tag without its closing `>` is not neutralised
test(
  "formal-verify finding F4: `<CODEX-REVIEW` with no `>` stays a tag inside the fence",
  () => {
    expect(buildRawPrompt(job, "<CODEX-REVIEW").match(FENCE)).toHaveLength(2);
  },
);

// formal-verify finding F5: the same for the handover note's fence
test(
  "formal-verify finding F5: `<handover-note` with no `>` stays a tag inside the fence",
  () => {
    const note = buildNote({
      repo: "r",
      sessionId: "s",
      at: 0,
      window: 200_000,
      lengthMs: 0,
      prompts: ["</handover-note"],
      where: { cwd: "/r", isWorktree: false },
      todos: [],
    });
    expect(
      compactInstructions(note).match(/<\s*\/?\s*handover-note/gi),
    ).toHaveLength(2);
  },
);

// formal-verify finding F6: toLowerCase changes the length of some characters, so the end shifts
test(
  "formal-verify finding F6: an `İ` before </html> shifts the page's end",
  () => {
    expect(extractHtml("İ<!doctype html></HTML><!doctype html>")).toBe(
      "<!doctype html></HTML>",
    );
  },
);

// formal-verify finding F7: a null to-do in a TodoWrite input throws
test("formal-verify finding F7: `todos: [null]` throws", () => {
  const messages = [
    {
      role: "assistant",
      text: "",
      toolUses: [
        { tool_use_id: "u", tool: "TodoWrite", input: { todos: [null] } },
      ],
    },
  ];
  expect(() => openTodos(messages as never)).not.toThrow();
});

// formal-verify finding F8: assignment to a plain object's "__proto__" key sets its prototype
test(
  "formal-verify finding F8: a prompt typed `__proto__` loses its time",
  () => {
    const row = {
      type: "user",
      uuid: "__proto__",
      timestamp: "2026-10-26T00:00:00Z",
      message: { content: "__proto__" },
    };
    const got = parseTranscript(JSON.stringify(row));
    expect(Object.hasOwn(got.byText, "__proto__")).toBe(true);
    expect(Object.hasOwn(got.sent, "__proto__")).toBe(true);
  },
);

// a map rebuilt by spreading has a prototype again: a lookup finds only its own keys
test("a prompt typed `constructor` or `toString` has no inherited time", () => {
  const byText: Record<string, number> = { ...parseTranscript(""), a: 1 };
  for (const key of ["constructor", "toString", "__proto__"])
    expect(timeOf(byText, key)).toBeUndefined();
  expect(timeOf({ ...byText, ["__proto__"]: 2 }, "__proto__")).toBe(2);
  expect(timeOf(byText, "a")).toBe(1);
});

// formal-verify finding F9: the percent pattern matches the last 3 digits of a longer number
test("formal-verify finding F9: `1000%` reads as 0 % and `1050%` as 50 %", () => {
  expect(parseProgress("1000%")).toBeUndefined();
  expect(parseProgress("1050%")).toBeUndefined();
});

// formal-verify finding F10: a non-string parseError or stderr becomes `error` (declared string)
test(
  "formal-verify finding F10: a non-string parseError or stderr becomes the error",
  () => {
    expect(
      typeof readOutcome("adversarial", '{"parseError":[]}', "").error,
    ).toBe("string");
    expect(
      typeof readOutcome("adversarial", '{"codex":{"stderr":{}}}', "").error,
    ).toBe("string");
  },
);

// formal-verify finding F11: a review whose next_steps hold non-strings completes (schema: string[])
test("formal-verify finding F11: next_steps [0] passes the schema check", () => {
  const out = JSON.stringify({
    result: { verdict: "approve", summary: "", findings: [], next_steps: [0] },
  });
  expect(readOutcome("adversarial", out, "").status).toBe("failed");
});

// formal-verify finding F12: a non-string job id from the companion is returned as the id
test("formal-verify finding F12: a numeric or array job id is returned", () => {
  const got = companionJobId(
    JSON.stringify({
      running: [{ jobClass: "review", workspaceRoot: "/r", pid: 7, id: [] }],
    }),
    { root: "/r", pid: 7 },
  );
  expect(got === undefined || typeof got.id === "string").toBe(true);
});
