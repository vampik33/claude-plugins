import { expect, test } from "claude-code/testing";

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

/** The engine beneath the mod: the ledger on disk, and a stop that nothing else blocks. */
function engine(on: any, file: () => string | null) {
  on("classic.Stop", () => ({}));
  on("fs.read", (_$: unknown, e: { path: string }) => {
    const text = e.path === `${CWD}/.fix-findings/ledger.json` ? file() : null;
    if (text === null) throw new Error("ENOENT");
    return { value: text };
  });
}

const stop = (over = {}) =>
  ({ stop_hook_active: false, cwd: CWD, session_id: ME, ...over }) as never;

test("a running ledger naming this session sends the model back", async ($: any, on: any) => {
  engine(on, () => running());
  expect((await $.classic.Stop(stop())).block).toContain("F1");
});

test("a ledger written any other way counts: only the file matters", async ($: any, on: any) => {
  let text: string | null = null;
  engine(on, () => text);
  expect((await $.classic.Stop(stop())).block).toBeUndefined();
  text = running();
  expect((await $.classic.Stop(stop())).block).toContain("F1");
});

test("a pre-existing finding does not hold the loop open", async ($: any, on: any) => {
  engine(on, () =>
    running({ findings: [{ id: "F1", state: "pre-existing", rounds: [2] }] }),
  );
  const block = (await $.classic.Stop(stop())).block;
  expect(block).toContain("no finding is open");
  expect(block).not.toContain("F1");
});

test("a ledger naming another session holds nothing back", async ($: any, on: any) => {
  engine(on, () => running({ sessionId: OTHER }));
  expect((await $.classic.Stop(stop())).block).toBeUndefined();
});

test("a ledger with no sessionId holds nothing back", async ($: any, on: any) => {
  engine(on, () => running({ sessionId: undefined }));
  expect((await $.classic.Stop(stop())).block).toBeUndefined();
});

test("the ledger is read from the session's working directory", async ($: any, on: any) => {
  engine(on, () => running());
  expect(
    (await $.classic.Stop(stop({ cwd: "/elsewhere" }))).block,
  ).toBeUndefined();
});

test("a broken ledger naming this session asks for a repair", async ($: any, on: any) => {
  engine(on, () => `{"sessionId": "${ME}", "status": `);
  expect((await $.classic.Stop(stop())).block).toContain("Repair");
});

test("a broken ledger naming nobody holds nothing back", async ($: any, on: any) => {
  engine(on, () => "{not json");
  expect((await $.classic.Stop(stop())).block).toBeUndefined();
});

test("it sends the model back once a turn only", async ($: any, on: any) => {
  engine(on, () => running());
  expect(
    (await $.classic.Stop(stop({ stop_hook_active: true }))).block,
  ).toBeUndefined();
});

test("work in flight lets the turn end", async ($: any, on: any) => {
  engine(on, () => running());
  const r = await $.classic.Stop(stop({ background_tasks: [{ id: "a" }] }));
  expect(r.block).toBeUndefined();
});

for (const status of ["converged", "stopped"]) {
  test(`a ${status} loop ends`, async ($: any, on: any) => {
    engine(on, () => running({ status }));
    expect((await $.classic.Stop(stop())).block).toBeUndefined();
  });
}

test("a deleted ledger ends the loop", async ($: any, on: any) => {
  engine(on, () => null);
  expect((await $.classic.Stop(stop())).block).toBeUndefined();
});

test("another hook's block stands", async ($: any, on: any) => {
  on("classic.Stop", () => ({ block: "theirs" }));
  on("fs.read", () => ({ value: running() }));
  expect((await $.classic.Stop(stop())).block).toBe("theirs");
});
