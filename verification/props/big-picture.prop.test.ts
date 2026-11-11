/**
 * Property tests for big-picture/hooks/core.ts.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import fc from "fast-check";

import {
  CHECK_EVERY,
  cleanText,
  emptyActivity,
  extractHtml,
  isCheckDue,
  liveShells,
  logTool,
  mayBeBig,
  mergeActivity,
  parseJev,
  placeholderHtml,
  digest,
  MERMAID_LOADER,
  MERMAID_LOADER_SHA256,
  OPEN_MS,
  OPEN_WAIT_S,
  openArgv,
  securePage,
  summaryPrompt,
  type Message,
} from "../../plugins/big-picture/hooks/core.ts";

const call = fc.record({
  tool: fc.constantFrom("Read", "Edit", "Write", "Bash", "Agent", "Grep"),
  input: fc.record({
    file_path: fc.constantFrom("/a", "/b", "/c"),
    command: fc.string(),
    description: fc.string(),
  }),
});

describe("logTool", () => {
  test("tools counts every call; edits are distinct; lists stay bounded", () => {
    fc.assert(
      fc.property(fc.array(call, { maxLength: 80 }), (calls) => {
        const a = calls.reduce(
          (acc, c) => logTool(acc, c.tool, c.input),
          emptyActivity(""),
        );
        expect(a.tools).toBe(calls.length);
        expect(new Set(a.edits).size).toBe(a.edits.length);
        expect(a.commands.length).toBeLessThanOrEqual(30);
        for (const s of [...a.commands, ...a.agents])
          expect(s.length).toBeLessThanOrEqual(200);
        expect(mayBeBig(a)).toBe(
          calls.some((c) => c.tool === "Edit" || c.tool === "Write"),
        );
      }),
    );
  });

  test("a check is due exactly at multiples of CHECK_EVERY", () => {
    fc.assert(
      fc.property(fc.nat(200), (n) => {
        const a = { ...emptyActivity(""), tools: n };
        expect(isCheckDue(a)).toBe(n > 0 && n % CHECK_EVERY === 0);
      }),
    );
  });
});

describe("mergeActivity", () => {
  test("logging two runs apart and merging them equals logging them as one", () => {
    fc.assert(
      fc.property(fc.array(call, { maxLength: 40 }), fc.array(call, { maxLength: 40 }), (xs, ys) => {
        const log = (cs: typeof xs) =>
          cs.reduce((acc, c) => logTool(acc, c.tool, c.input), emptyActivity(""));
        expect(mergeActivity(log(xs), log(ys))).toEqual(log([...xs, ...ys]));
      }),
    );
  });
});

describe("parsers never throw", () => {
  test("parseJev: a probability in [0, 1] or undefined", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.json()),
        fc.constantFrom("big" as const, "update" as const),
        (s, name) => {
          const p = parseJev(s, name);
          if (p !== undefined) expect(p >= 0 && p <= 1).toBe(true);
        },
      ),
    );
  });

});

describe("extractHtml", () => {
  test("finds a page wrapped in any prose", () => {
    const prose = fc
      .string()
      .filter((s) => !/<html|<\/html>|<!doctype/i.test(s));
    fc.assert(
      fc.property(prose, prose, fc.string(), (before, after, body) => {
        fc.pre(!/<\/html>/i.test(body));
        const page = `<!doctype html><html>${body}</html>`;
        expect(extractHtml(`${before}${page}${after}`)).toBe(page);
      }),
    );
  });
});

describe("placeholderHtml", () => {
  test("no tag of the text survives", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const body = placeholderHtml(s).split("<p>")[1]!.split("</p>")[0]!;
        expect(body).not.toMatch(/[<>"]/);
      }),
    );
  });
});

describe("digest", () => {
  const message: fc.Arbitrary<Message> = fc.record({
    role: fc.constantFrom("user" as const, "assistant" as const),
    text: fc.string(),
    toolUses: fc.array(
      fc.record({
        tool: fc.constantFrom("Edit", "Bash", "Read"),
        input: fc.record({ file_path: fc.string() }),
      }),
      { maxLength: 3 },
    ),
  });

  test("never over max, and the newest line kept whenever it fits", () => {
    fc.assert(
      fc.property(
        fc.array(message, { maxLength: 30 }),
        fc.nat(2000),
        (ms, max) => {
          const all = digest(ms, Number.MAX_SAFE_INTEGER).split("\n");
          const d = digest(ms, max);
          expect(d.length).toBeLessThanOrEqual(max);
          if (d !== "")
            expect(all.slice(-d.split("\n").length)).toEqual(d.split("\n"));
        },
      ),
    );
  });
});

describe("securePage", () => {
  test("the CSP hash is the Mermaid loader's", () => {
    const body = MERMAID_LOADER.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(createHash("sha256").update(body).digest("base64")).toBe(MERMAID_LOADER_SHA256);
  });

  test("no script, meta or link of the page survives but the mod's own, whatever it holds", () => {
    const piece = fc.constantFrom(
      "<script>x()</script>", "<SCRIPT src=a>", "<script\n>y", "</script>",
      "<scr", "ipt>", "<p>", "text", "<meta http-equiv=refresh content=0>",
      '<meta http-equiv="&#x72;efresh" content=0>', "<me", "ta ",
      "<link rel=dns-prefetch href=//x.example>", "<li", "nk ",
    );
    fc.assert(
      fc.property(fc.array(fc.oneof(piece, fc.string()), { maxLength: 20 }), (ps) => {
        const page = securePage(ps.join(""));
        expect(page.match(/<script\b/gi)?.length).toBe(1);
        expect(page.match(/<meta\b/gi)?.length).toBe(3);
        expect(page).not.toMatch(/<link\b/i);
      }),
    );
  });
});

describe("cleanText", () => {
  test("cleanText leaves no control character but newlines", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(cleanText(s)).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
      }),
    );
  });

});

describe("liveShells", () => {
  const id = fc.constantFrom("b1", "b2", "b3");
  const event = fc.oneof(
    id.map((i) => ({ start: i })),
    id.map((i) => ({ end: i })),
  );
  const toMessage = (e: { start?: string; end?: string }): Message =>
    e.start
      ? {
          role: "assistant",
          text: "",
          toolUses: [
            {
              tool: "Bash",
              input: { command: `run ${e.start}` },
              text: `Command running in background with ID: ${e.start}. Output is being written to: /t/tasks/${e.start}.output. You will be notified.`,
              result: { backgroundTaskId: e.start },
            },
          ],
        }
      : {
          role: "user",
          text: `<task-notification>\n<task-id>${e.end}</task-id>\n</task-notification>`,
          toolUses: [],
        };

  test("a shell is live iff its last event is a start; each once, with its own file", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 20 }), (events) => {
        const last = new Map<string, boolean>();
        for (const e of events) last.set((e.start ?? e.end)!, !!e.start);
        const live = liveShells(events.map(toMessage));
        expect(new Set(live.map((s) => s.id)).size).toBe(live.length);
        expect(new Set(live.map((s) => s.id))).toEqual(
          new Set([...last].filter(([, isLive]) => isLive).map(([i]) => i)),
        );
        for (const s of live) {
          expect(s.outputFile).toBe(`/t/tasks/${s.id}.output`);
          expect(s.command).toBe(`run ${s.id}`);
        }
      }),
    );
  });
});

describe("summaryPrompt", () => {
  test("no running commands leaves the prompt as it was; any carry each command", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.option(fc.string(), { nil: undefined }),
        fc.array(fc.record({ command: fc.string({ maxLength: 50 }), tail: fc.string() }), {
          maxLength: 3,
        }),
        (session, previous, running) => {
          if (running.length === 0)
            expect(summaryPrompt(session, previous, running)).toBe(
              summaryPrompt(session, previous),
            );
          else {
            const p = summaryPrompt(session, previous, running);
            expect(p).toContain("<running-commands>");
            for (const r of running) expect(p).toContain(`$ ${r.command}\n${r.tail}`);
          }
        },
      ),
    );
  });
});

/**
 * openArgv's script, run for real by sh on a PATH that holds only the tools it
 * needs and a fake opener: `xdg-open`, or `open` when `opener` says so.
 */
describe("openArgv", () => {
  const URL = "file:///h/my home/it's $HOME `x`.html";

  function run(fake: string, opener = "xdg-open", waitS?: number) {
    const dir = mkdtempSync(`${tmpdir()}/bp-open-`);
    for (const tool of ["sh", "setsid", "sleep"])
      symlinkSync(Bun.which(tool)!, `${dir}/${tool}`);
    writeFileSync(
      `${dir}/${opener}`,
      `#!/bin/sh\nprintf '%s\\n%s' "$$" "$1" > ${dir}/opened\n${fake}\n`,
    );
    chmodSync(`${dir}/${opener}`, 0o755);
    const at = performance.now();
    const p = Bun.spawnSync(openArgv(URL, waitS), { env: { PATH: dir } });
    const ms = performance.now() - at;
    const [pid, url] = readFileSync(`${dir}/opened`, "utf8").split("\n");
    rmSync(dir, { recursive: true });
    return { exitCode: p.exitCode, ms, pid: Number(pid), url };
  }

  const isAlive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test("xdg-open's failure is its exit code, as soon as it exits", () => {
    const r = run("exit 3");
    expect(r.exitCode).toBe(3);
    expect(r.ms).toBeLessThan(2_000);
    expect(r.url).toBe(URL);
  });

  test("xdg-open handing off and exiting is opened, as soon as it exits", () => {
    const r = run("exit 0");
    expect(r.exitCode).toBe(0);
    expect(r.ms).toBeLessThan(2_000);
  });

  test("the opener gives up waiting before the mod gives up on it", () => {
    expect(OPEN_WAIT_S * 1000).toBeLessThan(OPEN_MS);
  });

  test("a browser xdg-open runs in the foreground is opened after the wait, and keeps running in its own session", () => {
    const r = run("exec sleep 30", "xdg-open", 1);
    try {
      expect(r.exitCode).toBe(0);
      expect(r.ms).toBeGreaterThanOrEqual(1_000);
      expect(r.ms).toBeLessThan(3_000);
      expect(isAlive(r.pid)).toBe(true);
      const sid = Bun.spawnSync(["ps", "-o", "sid=", "-p", String(r.pid)]).stdout.toString().trim();
      expect(Number(sid)).toBe(r.pid); // setsid: its own session, out of the mod's process group
      expect(r.url).toBe(URL);
    } finally {
      if (isAlive(r.pid)) process.kill(r.pid);
    }
  });

  test("with no xdg-open, macOS's open gets the URL and its exit code is the answer", () => {
    const r = run("exit 1", "open");
    expect(r.exitCode).toBe(1);
    expect(r.url).toBe(URL);
  });
});
