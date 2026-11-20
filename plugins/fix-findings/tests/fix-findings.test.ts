import { expect, mock, test } from "claude-code/testing";

const CWD = "/repo";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const running = (over = {}) =>
  JSON.stringify({
    sessionId: ME,
    status: "running",
    round: 2,
    findings: [{ id: "F1", state: "open", rounds: [2] }],
    ...over,
  });

type Opts = {
  cwd?: string;
  agents?: { status: string }[];
  /** Runs while the mod waits on the agent list. */
  listing?: () => void;
  /** How the mod's own prompt is refused: dropped by a hook, or the call throws. */
  refuse?: () => "drop" | "throw" | undefined;
};

/** The test's mocked clock, set by `engine`. */
let clock: { advance: (ms: number) => Promise<unknown> };

/** The engine beneath the mod: the ledger on disk, the session, its agents, and the prompts sent. */
function engine(on: any, file: () => string | null, opts: Opts = {}) {
  const sent: string[] = [];
  const toasts: string[] = [];
  clock = mock.clock(on);
  on("session.cwd", () => ({ value: opts.cwd ?? CWD }));
  on("session.id", () => ({ value: ME }));
  on("agent.list", () => {
    opts.listing?.();
    return { value: opts.agents ?? [] };
  });
  on("fs.read", (_$: unknown, e: { path: string }) => {
    const text = e.path === `${CWD}/.fix-findings/ledger.json` ? file() : null;
    if (text === null) throw new Error("ENOENT");
    return { value: text };
  });
  on(
    "prompt.submit",
    (_$: unknown, e: { text: string; origin: { kind: string } }) => {
      const how = e.origin.kind === "plugin" ? opts.refuse?.() : undefined;
      if (how === "throw") throw new Error("boom");
      if (how === "drop") return { drop: "not now" };
      sent.push(e.text);
      return { text: e.text };
    },
  );
  on(
    "ui.toast",
    (_$: unknown, e: { text: string }) => (
      toasts.push(e.text),
      { value: undefined }
    ),
  );
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({
    text: e.answer,
  }));
  return Object.assign(sent, { toasts });
}

/** Ends a turn, then lets the prompt the mod sends without waiting on it arrive. */
async function turnEnd($: any, over: Record<string, unknown> = {}) {
  const r = await $.turn.complete({
    answer: "done",
    durationMs: 1,
    isAborted: false,
    turnId: "t",
    reason: "answer",
    ...over,
  } as never);
  await clock.advance(0);
  return r;
}

/** A prompt of the person's, typed while the session is idle. */
const typed = ($: any) =>
  $.prompt.submit({ text: "go on", origin: { kind: "composer" } } as never);

test("a running ledger naming this session sends the model back", async ($: any, on: any) => {
  const sent = engine(on, () => running());
  await turnEnd($);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("F1");
});

test("the turn's answer passes through unchanged", async ($: any, on: any) => {
  engine(on, () => running());
  expect((await turnEnd($)).text).toBe("done");
});

test("a ledger written any other way counts: only the file matters", async ($: any, on: any) => {
  let text: string | null = null;
  const sent = engine(on, () => text);
  await turnEnd($);
  expect(sent).toHaveLength(0);
  text = running();
  await turnEnd($);
  expect(sent).toHaveLength(1);
});

test("a pre-existing finding does not hold the loop open", async ($: any, on: any) => {
  const sent = engine(on, () =>
    running({ findings: [{ id: "F1", state: "pre-existing", rounds: [2] }] }),
  );
  await turnEnd($);
  expect(sent[0]).toContain("no finding is open");
  expect(sent[0]).not.toContain("F1");
});

test("a ledger naming another session holds nothing back", async ($: any, on: any) => {
  const sent = engine(on, () => running({ sessionId: OTHER }));
  await turnEnd($);
  expect(sent).toHaveLength(0);
});

test("a ledger with no sessionId holds nothing back", async ($: any, on: any) => {
  const sent = engine(on, () => running({ sessionId: undefined }));
  await turnEnd($);
  expect(sent).toHaveLength(0);
});

test("the ledger is read from the session's working directory", async ($: any, on: any) => {
  const sent = engine(on, () => running(), { cwd: "/elsewhere" });
  await turnEnd($);
  expect(sent).toHaveLength(0);
});

test("a broken ledger naming this session asks for a repair", async ($: any, on: any) => {
  const sent = engine(on, () => `{"sessionId": "${ME}", "status": `);
  await turnEnd($);
  expect(sent[0]).toContain("Repair");
});

test("a broken ledger naming nobody holds nothing back", async ($: any, on: any) => {
  const sent = engine(on, () => "{not json");
  await turnEnd($);
  expect(sent).toHaveLength(0);
});

test("it sends the model back once per prompt of the person's", async ($: any, on: any) => {
  const sent = engine(on, () => running());
  await turnEnd($);
  await turnEnd($, { turnId: "t2" }); // the turn it sent the model back into
  expect(sent).toHaveLength(1);
  await typed($);
  await turnEnd($, { turnId: "t3" });
  expect(sent).toHaveLength(3); // the person's prompt, then one more send-back
  expect(sent[2]).toContain("F1");
});

test("a prompt typed into the running turn does not reset the send-back", async ($: any, on: any) => {
  const sent = engine(on, () => running());
  await turnEnd($);
  await $.prompt.submit({
    text: "also this",
    origin: { kind: "composer" },
    turnId: "t2",
  } as never);
  await turnEnd($, { turnId: "t2" });
  expect(sent.filter((t) => t.includes("F1"))).toHaveLength(1);
});

for (const status of ["pending", "running"]) {
  test(`a ${status} agent lets the turn end`, async ($: any, on: any) => {
    const sent = engine(on, () => running(), { agents: [{ status }] });
    await turnEnd($);
    expect(sent).toHaveLength(0);
  });
}

for (const [what, after] of [
  ["another session takes the ledger over", { sessionId: OTHER }],
  ["the loop converges", { status: "converged" }],
] as const) {
  test(`no send-back when ${what} while agents are listed`, async ($: any, on: any) => {
    let text = running();
    const sent = engine(on, () => text, {
      listing: () => {
        text = running(after);
      },
    });
    await turnEnd($);
    expect(sent).toHaveLength(0);
  });
}

test("finished agents don't hold the send-back", async ($: any, on: any) => {
  const sent = engine(on, () => running(), {
    agents: [{ status: "completed" }, { status: "failed" }],
  });
  await turnEnd($);
  expect(sent).toHaveLength(1);
});

for (const reason of ["aborted", "error"]) {
  test(`a turn that ended by ${reason} is not sent back`, async ($: any, on: any) => {
    const sent = engine(on, () => running());
    await turnEnd($, { reason, isAborted: reason === "aborted" });
    expect(sent).toHaveLength(0);
  });
}

test("a subagent's turn is not sent back", async ($: any, on: any) => {
  const sent = engine(on, () => running());
  await turnEnd($, { agentId: "a1" });
  expect(sent).toHaveLength(0);
});

for (const status of ["converged", "stopped"]) {
  test(`a ${status} loop ends`, async ($: any, on: any) => {
    const sent = engine(on, () => running({ status }));
    await turnEnd($);
    expect(sent).toHaveLength(0);
  });
}

test("a deleted ledger ends the loop", async ($: any, on: any) => {
  const sent = engine(on, () => null);
  await turnEnd($);
  expect(sent).toHaveLength(0);
});

for (const how of ["drop", "throw"] as const) {
  test(`a send-back whose prompt is refused (${how}) says why and is tried again`, async ($: any, on: any) => {
    let refusing = true;
    const sent = engine(on, () => running(), {
      refuse: () => (refusing ? how : undefined),
    });
    await turnEnd($);
    expect(sent).toHaveLength(0);
    expect(sent.toasts).toHaveLength(1);
    expect(sent.toasts[0]).toContain("could not send Claude back");
    if (how === "drop") expect(sent.toasts[0]).toContain("not now");
    refusing = false;
    await turnEnd($, { turnId: "t2" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("F1");
  });
}

test("a turn a background task started may be sent back once more", async ($: any, on: any) => {
  const sent = engine(on, () => running());
  await turnEnd($);
  await $.prompt.submit({
    text: "<task-notification>review done</task-notification>",
    origin: { kind: "task-notification" },
  } as never);
  await turnEnd($, { turnId: "t2" });
  await turnEnd($, { turnId: "t3" }); // the turn it sent the model back into
  expect(sent.filter((t) => t.includes("F1"))).toHaveLength(2);
});
