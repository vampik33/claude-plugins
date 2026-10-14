/**
 * Property tests for ship/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  bandLine,
  canShip,
  hasNews,
  installedVersions,
  needRestart,
  parseStatus,
  staleMods,
} from "../../plugins/ship/hooks/core.ts";

const name = fc.stringMatching(/^[a-z][a-z-]{0,11}$/);
const version = fc.tuple(fc.nat(9), fc.nat(9), fc.nat(9)).map((v) => v.join("."));
const versions = fc.dictionary(name, version, { maxKeys: 8 });

describe("staleMods / needRestart", () => {
  test("stale is exactly the installed mods the repo lists at another version, sorted", () => {
    fc.assert(
      fc.property(versions, versions, (repo, installed) => {
        const stale = staleMods(repo, installed);
        const names = stale.map((s) => s.name);
        expect(names).toEqual([...names].sort());
        for (const n of Object.keys(installed)) {
          const expected = repo[n] !== undefined && repo[n] !== installed[n];
          expect(names.includes(n)).toBe(expected);
        }
        for (const s of stale) {
          expect(s.installed).toBe(installed[s.name]);
          expect(s.repo).toBe(repo[s.name]);
        }
      }),
    );
  });

  test("no restart when nothing changed since loading", () => {
    fc.assert(
      fc.property(versions, (v) => {
        expect(needRestart(v, v)).toEqual([]);
        expect(staleMods(v, v)).toEqual([]);
      }),
    );
  });
});

describe("parseStatus", () => {
  test("reads the branch, ahead and changed count it was written with", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9/_-]{0,15}$/),
        fc.boolean(),
        fc.nat(50),
        fc.nat(20),
        (branch, upstream, ahead, changed) => {
          const head = `## ${branch}${upstream ? `...origin/${branch}` : ""}${upstream && ahead ? ` [ahead ${ahead}]` : ""}`;
          const out = parseStatus([head, ...Array(changed).fill(" M f.ts"), ""].join("\n"));
          expect(out).toEqual({
            branch,
            hasUpstream: upstream,
            ahead: upstream ? ahead : 0,
            changed,
          });
        },
      ),
    );
  });
});

describe("installedVersions", () => {
  test("keeps only the named marketplace's plugins, by bare name", () => {
    fc.assert(
      fc.property(versions, versions, (mine, theirs) => {
        const plugins: Record<string, { version: string }[]> = {};
        for (const [n, v] of Object.entries(theirs)) plugins[`${n}@other`] = [{ version: v }];
        for (const [n, v] of Object.entries(mine)) plugins[`${n}@mine`] = [{ version: v }];
        expect(installedVersions(JSON.stringify({ plugins }), "mine")).toEqual(mine);
      }),
    );
  });
});

describe("bandLine", () => {
  test("one line that leads with the branch; news iff something to say", () => {
    fc.assert(
      fc.property(
        fc.record({
          branch: fc.stringMatching(/^[a-z]{1,8}$/),
          hasUpstream: fc.boolean(),
          ahead: fc.nat(9),
          changed: fc.nat(9),
          stale: fc.array(fc.record({ name, installed: version, repo: version }), { maxLength: 3 }),
          restart: fc.array(name, { maxLength: 3 }),
        }),
        (s) => {
          const line = bandLine(s);
          expect(line.startsWith(`ship · ${s.branch}`)).toBe(true);
          expect(line).not.toMatch(/\n/);
          expect(hasNews(s)).toBe(s.ahead > 0 || s.stale.length > 0 || s.restart.length > 0);
          if (canShip(s)) expect(hasNews(s)).toBe(true);
        },
      ),
    );
  });
});
