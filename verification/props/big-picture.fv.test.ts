/**
 * formal-verify T2: big-picture's page and text sanitizers (plugins/big-picture/hooks/core.ts).
 * Spec answers in .formal-verify/targets.md § T2. The page oracle is parse5, a spec-compliant
 * HTML5 parser (H7: an independent implementation). Guarantee ceiling: EXPLORED.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parse } from "parse5";

import {
  BASE_CSS,
  cleanText,
  extractHtml,
  MERMAID_LOADER,
  placeholderHtml,
  securePage,
  REFRESH_S,
  SUMMARY_CSP,
} from "../../plugins/big-picture/hooks/core.ts";

const SEED = Number(process.env.FV_SEED ?? 20261026);
const RUNS = Number(process.env.FV_RUNS ?? 300);
const opts = (o: fc.Parameters<any> = {}) => ({
  seed: SEED,
  numRuns: RUNS,
  ...o,
});

type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
  parentNode?: Node;
  value?: string;
};

/** Every element in document order, template contents included, any namespace. */
function elements(n: Node, out: Node[] = []): Node[] {
  if (n.tagName) out.push(n);
  for (const c of n.childNodes ?? []) elements(c, out);
  if (n.content) elements(n.content, out);
  return out;
}
const attr = (n: Node, name: string) =>
  n.attrs?.find((a) => a.name === name)?.value;
const text = (n: Node): string =>
  n.nodeName === "#text" ? n.value! : (n.childNodes ?? []).map(text).join("");

const LOADER_BODY = MERMAID_LOADER.replace(/^<script[^>]*>/, "").replace(
  /<\/script>$/,
  "",
);

/** Pieces that make tags, split tags, foreign content and raw-text states likely (Q3). */
const piece = fc.constantFrom(
  "<script>x()</script>",
  "<SCRIPT src=a>",
  "<script\n>y",
  "<script/x>",
  "<script\t",
  "</script >",
  "</script/>",
  "</script",
  "<scr",
  "ipt>",
  "<s",
  "cript>",
  "<svg>",
  "</svg>",
  "<math>",
  "<svg><script>a()</script>",
  "<template>",
  "</template>",
  "<noscript>",
  "<!--",
  "-->",
  "<![CDATA[",
  "]]>",
  "<style>",
  "</style>",
  "<textarea>",
  "<xmp>",
  "<plaintext>",
  "<iframe srcdoc='<script>x()</script>'>",
  "<p>",
  "text",
  "<meta http-equiv=refresh content=0>",
  '<meta http-equiv="&#x72;efresh" content=0>',
  "<META ",
  "<me",
  "ta ",
  "<meta/",
  "<meta\0",
  "<link rel=dns-prefetch href=//x.example>",
  "<li",
  "nk ",
  "<LINK",
  "<base href=//x.example/>",
  "<BASE ",
  "<ba",
  "se>",
  '"',
  "'",
  ">",
  "<",
  "/",
  "\0",
  "\n",
  "=",
  " ",
  "<html>",
  "<head>",
  "<body>",
  "<!doctype html>",
  "<object data=x>",
  "<embed src=x>",
);
const page = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: piece },
      { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
    ),
    {
      maxLength: 60,
    },
  )
  .map((a) => a.join(""));

describe("P1 securePage", () => {
  // P1 (Q5: "parsed by a real HTML5 parser: exactly 1 script, the Mermaid loader byte for byte;
  //     only the mod's own 3 meta, the CSP one first and in head, then its refresh; 0 link and 0 base; the CSP
  //     before any of the page's content")
  // mutant: core.ts:366 `/gi` -> `/g` on the script pattern   input: examples[0] "<SCRIPT>x()</SCRIPT>"
  // mutant: core.ts:363 `was !== body` -> `was === ""`   input: examples[2] split tag
  // mutant: core.ts:367 `(meta|link)` -> `(meta)`   input: examples[1]
  test("only the mod's script and metas survive, the CSP first in head, no link", () => {
    fc.assert(
      fc.property(page, (p) => {
        const doc = parse(securePage(p)) as unknown as Node;
        const els = elements(doc);
        const scripts = els.filter((e) => e.tagName === "script");
        expect(scripts).toHaveLength(1);
        expect(text(scripts[0]!)).toBe(LOADER_BODY);
        expect(attr(scripts[0]!, "type")).toBe("module");
        expect(attr(scripts[0]!, "src")).toBeUndefined();
        const metas = els.filter((e) => e.tagName === "meta");
        expect(metas).toHaveLength(3);
        expect(attr(metas[0]!, "charset")).toBe("utf-8");
        expect(attr(metas[1]!, "http-equiv")?.toLowerCase()).toBe(
          "content-security-policy",
        );
        expect(attr(metas[1]!, "content")).toBe(SUMMARY_CSP);
        expect(metas[1]!.parentNode?.tagName).toBe("head");
        expect(attr(metas[2]!, "http-equiv")).toBe("refresh");
        expect(attr(metas[2]!, "content")).toBe(String(REFRESH_S));
        // nothing of the page comes before the CSP: html, head, then the charset meta
        expect(els.slice(0, 4).map((e) => e.tagName)).toEqual([
          "html",
          "head",
          "meta",
          "meta",
        ]);
        expect(els.filter((e) => e.tagName === "link").map((e) => e.tagName)).toEqual([]);
      }),
      opts({
        numRuns: RUNS * 3,
        examples: [
          ["<SCRIPT>x()</SCRIPT>"],
          ["<link rel=preconnect href=//x.example>"],
          ["<scr<script></script>ipt>alert(1)</script>"],
        ],
      }),
    );
  });
});

describe("P1b securePage stylesheet", () => {
  // the mod's stylesheet is in head, once, byte for byte, whatever the page holds; a page
  // read back from disk and secured again (a rewrite after a reload) still holds it once
  // mutant: the strip of the mod's own stylesheet removed   input: any page, secured twice
  test("one mod stylesheet in head, after the loader, also when secured twice", () => {
    fc.assert(
      fc.property(page, fc.boolean(), (p, twice) => {
        const secured = twice ? securePage(securePage(p)) : securePage(p);
        const els = elements(parse(secured) as unknown as Node);
        const mine = els.filter((e) => e.tagName === "style" && attr(e, "data-big-picture") !== undefined);
        expect(mine).toHaveLength(1);
        expect(text(mine[0]!)).toBe(BASE_CSS);
        expect(mine[0]!.parentNode?.tagName).toBe("head");
        expect(els.indexOf(mine[0]!)).toBe(els.findIndex((e) => e.tagName === "script") + 1);
      }),
      opts({ examples: [["<p>x</p>", true]] }),
    );
  });
});

// P1's "0 base" check was dropped with the user's OK (2026-10-26, D2 2a): a <base> left in the page
// is held by the CSP's base-uri 'none'. The link, script and meta checks above are unchanged.

describe("P2 placeholderHtml", () => {
  // P2 (Q5: "the parsed <p> text equals the input, and the input adds no element"); the parser
  // drops NUL in body text and folds CR/CRLF to LF, which the oracle applies (H7)
  // mutant: core.ts:425 `[&<>"]` -> `[<>"]`   input: examples[0] "&lt;"
  test("the text reads back, no element added", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 2000 }), (s) => {
        const doc = parse(placeholderHtml(s)) as unknown as Node;
        const els = elements(doc).map((e) => e.tagName);
        expect(els).toEqual([
          "html",
          "head",
          "meta",
          "meta",
          "title",
          "style",
          "body",
          "p",
        ]);
        const p = elements(doc).find((e) => e.tagName === "p")!;
        expect(text(p)).toBe(s.replace(/\r\n?/g, "\n").replace(/\0/g, ""));
      }),
      opts({
        examples: [["&lt;"], ["</p><script>x()</script>"], ['"><img src=x>']],
      }),
    );
  });
});

/** A well-formed escape sequence: CSI with params, OSC ended by BEL or ST (Q3). */
const escSeq = fc.oneof(
  fc
    .tuple(
      fc.stringMatching(/^[0-?]{0,6}$/),
      fc.stringMatching(/^[ -/]{0,2}$/),
      fc.stringMatching(/^[@-~]$/),
    )
    .map(([p, i, f]) => `\x1b[${p}${i}${f}`),
  fc
    .tuple(
      fc.string({ maxLength: 20 }).filter((s) => !/[\x07\x1b]/.test(s)),
      fc.constantFrom("\x07", "\x1b\\"),
    )
    .map(([b, t]) => `\x1b]${b}${t}`),
);
const control = fc
  .integer({ min: 0, max: 0x9f })
  .filter((c) => c < 0x20 || c >= 0x7f)
  .filter((c) => c !== 0x1b)
  .map((c) => String.fromCharCode(c));
/** Text with no control character and no ESC. */
const plain = fc
  .string({ unit: "binary", maxLength: 30 })
  .map((s) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, ""));

describe("P3 cleanText", () => {
  // P3 (Q5: "no C0 or C1 control character remains except \n")
  // mutant: core.ts:389 `[\x00-\x09\x0b-\x1f\x7f-\x9f]` -> `[\x00-\x09\x0b-\x1f\x7f]`   input: examples[0]
  test("no control character but newlines remains", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 4000 }), (s) => {
        expect(cleanText(s)).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
      }),
      opts({ examples: [["a\x85b"]] }),
    );
  });

  // P3 (Q5: "characters that aren't controls are kept, in order"): text built of plain runs,
  // escape sequences and controls reads back as its plain runs (tabs as two spaces, CR as LF)
  // mutant: core.ts:388 `\x1b\][^\x07\x1b]*` -> `\x1b\][\s\S]*`   input: examples[0]
  // mutant: core.ts:387 `.replace(/\t/g, "  ")` -> `.replace(/\t/g, " ")`   input: examples[1]
  test("plain text between escapes and controls is kept in order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            plain.map((t) => ({ t })),
            escSeq.map((e) => ({ e })),
            control.map((c) => ({ c })),
            // a lone ESC before a letter: the ESC is a control, the letter is text
            fc.constantFrom("a", "c", "Z", "7").map((x) => ({ l: `\x1b${x}` })),
          ),
          {
            maxLength: 20,
          },
        ),
        (parts) => {
          const input = parts
            .map((p) => ("t" in p ? p.t : "e" in p ? p.e : "l" in p ? p.l : p.c))
            .join("");
          // the oracle: plain runs in order, tab as two spaces, CR LF (adjacent in the input) and a
          // lone CR as one LF, every other control and every escape sequence gone
          const out: string[] = [];
          parts.forEach((p, i) => {
            if ("t" in p) out.push(p.t);
            else if ("l" in p) out.push(p.l.slice(1));
            else if ("c" in p) {
              if (p.c === "\t") out.push("  ");
              else if (p.c === "\n") {
                const prev = parts[i - 1];
                if (!(prev && "c" in prev && prev.c === "\r")) out.push("\n");
              } else if (p.c === "\r") out.push("\n");
            }
          });
          expect(cleanText(input)).toBe(out.join("").trim());
        },
      ),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [[{ e: "\x1b]0;t\x07" }, { t: "keep" }, { e: "\x1b]8;;\x07" }]],
          [[{ t: "a" }, { c: "\t" }, { t: "b" }]],
          [[{ t: "a" }, { c: "\r" }, { t: "b" }]],
          [[{ t: "a" }, { c: "\r" }, { c: "\n" }, { t: "b" }]],
        ],
      }),
    );
  });
});

/** P5's checks: the oracle finds the page with its own search over the original string (H7). */
function checkExtract(s: string) {
  const got = extractHtml(s);
  const start = s.search(/<!doctype html|<html[\s>]/i);
  const ends = [...s.matchAll(/<\/html>/gi)].map((m) => m.index!);
  const hasPage = start >= 0 && ends.some((e) => e >= start);
  if (!hasPage) {
    expect(got).toBeUndefined();
    return;
  }
  expect(got).toBeDefined();
  expect(s.includes(got!)).toBe(true);
  expect(got!).toMatch(/^(<!doctype html|<html[\s>])/i);
  expect(got!.toLowerCase().endsWith("</html>")).toBe(true);
  expect(s.indexOf(got!)).toBe(start);
  expect(got!.length).toBe(Math.max(...ends) + 7 - start);
}
const PAGE_BITS = ["<!doctype html>", "<!DOCTYPE HTML>", "<html>", "<HTML lang=en>", "<html\n", "<htmlx>", "</html>", "</HTML>", "```", "prose "];

describe("P5 extractHtml", () => {
  // P5 (Q5: "the result starts with a doctype or <html and ends with </html>, a substring of the
  //     input"); undefined only when the input holds no such page (Q4)
  // mutant: core.ts:328 `end < start` -> `end < 0`   input: examples[0]
  // mutant: core.ts:329 `+ "</html>".length` -> `+ 6`   input: any page
  test("a page from its start to the last </html>, or undefined when there is none", () => {
    const bit = fc.oneof(fc.constantFrom(...PAGE_BITS, "İ", "ẞ", "ﬃ"), fc.string({ unit: "binary", maxLength: 10 }));
    fc.assert(
      fc.property(fc.array(bit, { maxLength: 20 }).map((a) => a.join("")), checkExtract),
      opts({ numRuns: RUNS * 3, examples: [["</html><html>"], ["İ<html></html>"]] }),
    );
  });

  // P5, the same checks on ASCII text: a sub-case of the property above, kept so its other checks
  // still bite while the full one is VIOLATED (the full property is unchanged)
  // mutant: core.ts:328 `end < start` -> `end < 0`   input: examples[0]
  test("ASCII: a page from its start to the last </html>, or undefined", () => {
    const bit = fc.oneof(fc.constantFrom(...PAGE_BITS), fc.string({ maxLength: 10 }));
    fc.assert(
      fc.property(fc.array(bit, { maxLength: 20 }).map((a) => a.join("")), checkExtract),
      opts({ numRuns: RUNS * 3, examples: [["</html><html>"], [" <html></html>"]] }),
    );
  });
});
