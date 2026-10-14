import { describe, expect, mock, test } from "claude-code/testing";

import type { ShipStatus } from "../types";
import {
  bandLine,
  canShip,
  hasNews,
  installedVersions,
  marketplaceVersions,
  needRestart,
  parseStatus,
  staleMods,
} from "../hooks/core.ts";

const status = (over: Partial<ShipStatus> = {}): ShipStatus => ({
  branch: "main",
  hasUpstream: true,
  ahead: 0,
  changed: 0,
  stale: [],
  restart: [],
  ...over,
});

describe("reading", () => {
  test("git status: branch, upstream, ahead, changed", () => {
    expect(parseStatus("## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n")).toEqual({
      branch: "main",
      hasUpstream: true,
      ahead: 2,
      changed: 2,
    });
    expect(parseStatus("## feat/x\n")).toEqual({
      branch: "feat/x",
      hasUpstream: false,
      ahead: 0,
      changed: 0,
    });
    expect(parseStatus("## No commits yet on main\n").branch).toBe("main");
  });

  test("the marketplace's name and versions", () => {
    const json = JSON.stringify({
      name: "vampik-plugins",
      plugins: [
        { name: "fleet", version: "0.5.0" },
        { name: "gtr", version: "1.0.0" },
        { name: "broken" },
      ],
    });
    expect(marketplaceVersions(json)).toEqual({
      name: "vampik-plugins",
      versions: { fleet: "0.5.0", gtr: "1.0.0" },
    });
  });

  test("installed versions from one marketplace only", () => {
    const json = JSON.stringify({
      plugins: {
        "fleet@vampik-plugins": [{ scope: "user", version: "0.4.2" }],
        "hookify@claude-plugins-official": [{ scope: "user", version: "9.9.9" }],
        "odd@vampik-plugins": [],
      },
    });
    expect(installedVersions(json, "vampik-plugins")).toEqual({ fleet: "0.4.2" });
  });

  test("stale: installed and in the repo at another version", () => {
    expect(
      staleMods(
        { fleet: "0.5.0", ship: "0.1.0", palette: "0.4.2" },
        { palette: "0.4.2", fleet: "0.4.2", other: "1.0.0" },
      ),
    ).toEqual([{ name: "fleet", installed: "0.4.2", repo: "0.5.0" }]);
  });

  test("restart: installed now at another version than loaded", () => {
    expect(needRestart({ fleet: "0.4.2", palette: "0.4.2" }, { fleet: "0.5.0", palette: "0.4.2", ship: "0.1.0" })).toEqual(["fleet"]);
  });
});

describe("words", () => {
  test("the band line", () => {
    expect(
      bandLine(
        status({
          ahead: 2,
          changed: 3,
          stale: [{ name: "fleet", installed: "0.4.2", repo: "0.5.0" }],
          restart: ["palette"],
        }),
      ),
    ).toBe("ship · main ↑2 · ●3 uncommitted · fleet 0.4.2 → 0.5.0 · restart needed");
    expect(bandLine(status())).toBe("ship · main");
  });

  test("news and something to ship", () => {
    expect(hasNews(status())).toBe(false);
    expect(hasNews(status({ changed: 4 }))).toBe(false);
    expect(hasNews(status({ restart: ["x"] }))).toBe(true);
    expect(canShip(status({ restart: ["x"] }))).toBe(false);
    expect(canShip(status({ ahead: 1 }))).toBe(true);
    expect(canShip(status({ stale: [{ name: "a", installed: "1", repo: "2" }] }))).toBe(true);
  });
});

const ROOT = "/r/claude-plugins";
const MKT = `${ROOT}/.claude-plugin/marketplace.json`;
const INSTALLED = "/home/u/.claude/plugins/installed_plugins.json";

/** A repo, its marketplace and the installed plugins, and the commands the mod runs. */
function world(on: any) {
  const w = {
    /** False outside a marketplace repo: no marketplace.json at the root. */
    isMarketplace: true,
    branch: "main",
    ahead: 0,
    changed: 0,
    repo: { fleet: "0.5.0", palette: "0.4.2" } as Record<string, string>,
    installed: { fleet: "0.4.2", palette: "0.4.2" } as Record<string, string>,
    /** What the GitHub copy of the marketplace holds: what an update installs. */
    remote: { fleet: "0.4.2", palette: "0.4.2" } as Record<string, string>,
    pushFails: false,
    ran: [] as string[],
  };
  const ok = (stdout = "") => ({
    value: { exitCode: 0, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
  });
  const fail = (stderr: string) => ({
    value: { exitCode: 1, stdout: "", stderr, isStdoutTruncated: false, isStderrTruncated: false },
  });
  mock.env(on, { HOME: "/home/u" });
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({ text: e.answer }));
  on("ui.render", () => h("Box", null));
  on("session.start", (_$: unknown, e: unknown) => e);
  on("command.register", () => ({ value: undefined }));
  on("fs.read", (_$: unknown, e: { path: string }) => {
    if (e.path === MKT && w.isMarketplace)
      return {
        value: JSON.stringify({
          name: "vampik-plugins",
          plugins: Object.entries(w.repo).map(([name, version]) => ({ name, version })),
        }),
      };
    if (e.path === INSTALLED)
      return {
        value: JSON.stringify({
          plugins: Object.fromEntries(
            Object.entries(w.installed).map(([n, v]) => [`${n}@vampik-plugins`, [{ scope: "user", version: v }]]),
          ),
        }),
      };
    return { deny: "no such file" };
  });
  on("process.run", (_$: unknown, e: { argv: string[] }) => {
    const cmd = e.argv.join(" ");
    w.ran.push(cmd);
    if (cmd === "git rev-parse --show-toplevel") return ok(`${ROOT}\n`);
    if (cmd.startsWith("git status"))
      return ok(
        `## ${w.branch}...origin/${w.branch}${w.ahead ? ` [ahead ${w.ahead}]` : ""}\n` +
          " M x.ts\n".repeat(w.changed),
      );
    if (cmd === "git push") {
      if (w.pushFails) return fail("! [rejected] main -> main (fetch first)\nerror: failed to push");
      w.ahead = 0;
      w.remote = { ...w.repo };
      return ok();
    }
    if (cmd === "claude plugin marketplace update vampik-plugins") return ok("✔ updated");
    const up = /^claude plugin update (\S+)@vampik-plugins$/.exec(cmd);
    if (up) {
      w.installed[up[1]!] = w.remote[up[1]!]!;
      return ok();
    }
    return fail(`unexpected: ${cmd}`);
  });
  return w;
}

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

const start = async ($: any) => {
  await $.session.start({ cwd: ROOT } as never);
};
const runShip = async ($: any) =>
  (await $.command.run({ command: "ship", args: "" } as never)).text as string;

describe("session", () => {
  for (const surface of ["terminal", "desktop"] as const)
    test(`the band shows what is unshipped, and nothing when all is current (${surface})`, async ($, on) => {
      const w = world(on);
      w.ahead = 2;
      w.changed = 1;
      await start($);
      let ui = await $.ui.mount({ plugin: "ship", surface, ...BAND });
      expect(
        await ui.find({ type: "Text", text: "ship · main ↑2 · ●1 uncommitted · fleet 0.4.2 → 0.5.0" }),
      ).toBeDefined();
      expect((await ui.find({ key: "ship-run" }))?.text).toBe("ship");
      await ui.unmount();

      w.ahead = 0;
      w.installed.fleet = "0.5.0";
      await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t", reason: "answer" } as never);
      ui = await $.ui.mount({ plugin: "ship", surface, ...BAND });
      // fleet was updated outside a restart: the session still runs 0.4.2
      expect(await ui.find({ type: "Text", text: "ship · main · ●1 uncommitted · restart needed" })).toBeDefined();
      expect(await ui.find({ key: "ship-run" })).toBeUndefined();
      await ui.unmount();
    });

  test("/ship pushes, refreshes the marketplace, updates the stale mods and asks for a restart", async ($, on) => {
    const w = world(on);
    w.ahead = 1;
    await start($);
    const text = await runShip($);
    expect(w.ran.filter((c) => !c.startsWith("git status") && !c.startsWith("git rev-parse"))).toEqual([
      "git push",
      "claude plugin marketplace update vampik-plugins",
      "claude plugin update fleet@vampik-plugins",
    ]);
    expect(text).toBe(
      ["Pushed 1 commit on main.", "Updated fleet 0.4.2 → 0.5.0.", "Restart Claude Code to load: fleet."].join("\n"),
    );
  });

  test("/ship stops at a failed push and says why", async ($, on) => {
    const w = world(on);
    w.ahead = 1;
    w.pushFails = true;
    await start($);
    expect(await runShip($)).toBe(
      "ship: git push failed:\n! [rejected] main -> main (fetch first)\nerror: failed to push",
    );
    expect(w.ran.some((c) => c.startsWith("claude plugin"))).toBe(false);
  });

  test("/ship on another branch pushes it but updates no mod", async ($, on) => {
    const w = world(on);
    w.branch = "feat/x";
    w.ahead = 1;
    await start($);
    const text = await runShip($);
    expect(text).toBe(
      ["Pushed 1 commit on feat/x.", "On feat/x: the marketplace reads main, so no mod was updated."].join("\n"),
    );
    expect(w.ran.some((c) => c.startsWith("claude plugin"))).toBe(false);
  });

  test("/ship says when the update did not bring the repo's version", async ($, on) => {
    const w = world(on);
    w.changed = 2; // the bump is not committed: GitHub still has 0.4.2
    await start($);
    const text = await runShip($);
    expect(text).toBe(
      [
        "Still behind the repo: fleet 0.4.2 (repo 0.5.0); is the version bump committed and pushed?",
        "2 uncommitted files were not shipped.",
      ].join("\n"),
    );
  });

  test("/ship with nothing to do", async ($, on) => {
    const w = world(on);
    w.installed.fleet = "0.5.0";
    await start($);
    expect(await runShip($)).toBe(
      "Nothing to ship: no commits to push and every installed mod is current.",
    );
  });

  test("outside a marketplace repo the band stays empty and /ship says so", async ($, on) => {
    const w = world(on);
    w.isMarketplace = false;
    await start($);
    expect(await runShip($)).toMatch(/^ship: this is not a plugin marketplace repo/);
  });
});
