import { atom, memberOf, read, update } from "claude-code";
import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
} from "claude-code";

import type { ToolLensStats } from "../types";
import {
  argsChars,
  callLabel,
  countLines,
  diffSources,
  diffsOf,
  estimateTokens,
  fmtDuration,
  fmtTokens,
  iconOf,
  logTailArgv,
  mergeMs,
  omittedFiles,
  parseLog,
  shortPath,
} from "./core.ts";

const stats = atom(
  { plugin: "tool-lens", key: "stats" } as const,
  null as ToolLensStats | null,
);
const isOpen = atom({ plugin: "tool-lens", key: "isOpen" } as const, false);
const logged = atom(
  { plugin: "tool-lens", key: "logged" } as const,
  {} as Record<string, ToolLensStats>,
);

/** Reads the tail of this session's log and keeps its calls' figures. */
async function backfill($: EngineInterface): Promise<void> {
  const [configEnv, home, id] = await Promise.all([
    $.env.get("CLAUDE_CONFIG_DIR"),
    $.env.get("HOME"),
    $.session.id(),
  ]);
  const configDir = configEnv ?? (home ? `${home}/.claude` : "");
  if (!configDir) return;
  const argv = logTailArgv(`${configDir}/projects`, id);
  if (!argv) return;
  const { stdout } = await $.process.run(argv);
  const fromLog = parseLog(stdout);
  await update($, logged, () => fromLog);
}

/** Keeps Claude Code's own duration for a call: it never counts an approval wait or hooks. */
async function recordExact(
  $: EngineInterface,
  id: string,
  ms: number | undefined,
): Promise<void> {
  if (typeof ms !== "number") return;
  await update($, memberOf(stats, { requestId: id }), (s) =>
    mergeMs(s, ms, true),
  );
}

type Site = RenderInput<"ToolUse" | "ToolGroup">;

/** One call as the line draws it: a ToolUse row's props or a group's call. */
type Call = {
  tool_use_id?: string;
  tool: string;
  input: unknown;
  isRunning: boolean;
  isErrored: boolean;
  isInterrupted: boolean;
  output?: unknown;
};

/** Whether a press reaches a Button in a transcript row: the fullscreen terminal or any app surface. */
function isClickable(e: Pick<RenderInput, "surface" | "viewport">): boolean {
  return e.surface !== "terminal" || e.viewport?.isFullscreen === true;
}

/**
 * A call's line (icon, label when given, duration, tokens, diff toggle) and,
 * when toggled open, its diff below it.
 */
async function callLine(
  $: EngineInterface,
  e: Site,
  call: Call,
  label: string | undefined,
  cwd: string | undefined,
): Promise<RenderElement> {
  const { Box, Button, Code, Text } = $.ui.resolve(e);
  const id = call.tool_use_id;
  const diffs = call.isRunning ? [] : diffsOf(call.tool, call.output);
  const toggleId = diffs.length > 0 && isClickable(e) ? id : undefined;
  const [live, open] = await Promise.all([
    id ? read($, memberOf(stats, { requestId: id })) : null,
    toggleId !== undefined &&
      read($, memberOf(isOpen, { requestId: toggleId })),
  ]);
  // the log's figures only where the call ran before the mod did
  const s = live ?? (id ? (await read($, logged))[id] : undefined);

  const color = call.isRunning
    ? "warning"
    : call.isErrored || call.isInterrupted
      ? "error"
      : "success";
  const facts = [
    label ?? "",
    // ≈: read from the log, so any approval wait is in it
    s?.ms !== undefined ? `${s.isFromLog ? "≈" : ""}${fmtDuration(s.ms)}` : "",
    s?.tokens !== undefined ? fmtTokens(s.tokens) : "",
  ].filter(Boolean);
  const { added, removed } = countLines(diffs);
  const { files, cut } = diffSources(diffs);
  // files Claude Code changed but gave no hunks for: the counts are partial
  const more = omittedFiles(call.tool, call.output);
  const showPaths = files.length > 1 || call.tool === "Bash";

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text color={color}>{iconOf(call.tool)}</Text>
        {facts.length > 0 && <Text dimColor> {facts.join(" · ")}</Text>}
        {toggleId !== undefined && <Text dimColor> · </Text>}
        {toggleId !== undefined && (
          <Button
            key={`diff:${toggleId}`}
            label={`${open ? "▾" : "▸"} diff +${added} −${removed}${more > 0 ? ` +${more} more files` : ""}`}
            plain
            onPress={() =>
              update($, memberOf(isOpen, { requestId: toggleId }), (v) => !v)
            }
          />
        )}
      </Box>
      {open && (
        <Box flexDirection="column" paddingLeft={4}>
          {files.map((f) => (
            <Box flexDirection="column">
              {showPaths && <Text dimColor>{shortPath(f.path, cwd)}</Text>}
              <Code source={f.source} path={f.path} format="diff" />
            </Box>
          ))}
          {cut > 0 && <Text dimColor>… {cut} more diff lines</Text>}
          {more > 0 && (
            <Text color="warning">
              … {more} more changed files not shown; their diff is under the
              call's result
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export const register: Register = (on) => {
  /** The session's folder, to show paths relative to it. */
  let cwd: string | undefined;

  // At load, a reload or a resume: calls made before the mod ran get their
  // figures from the session log.
  on("session.start", async ($, e, next) => {
    cwd = e.cwd;
    const started = await next(e);
    try {
      await backfill($);
    } catch {
      // no log to read (a host without env, process or the file): older calls stay bare
    }
    return started;
  });

  on("tool.call", async ($, e, next) => {
    const startedAt = await $.clock.now();
    const ran = await next(e);
    const ms = (await $.clock.now()) - startedAt;
    const read = ran.deny ?? ran.text ?? "";
    const tokens = estimateTokens(
      argsChars(e as unknown as Record<string, unknown>) + read.length,
    );
    await update($, memberOf(stats, { requestId: e.tool_use_id }), (s) => ({
      ...mergeMs(s, ms, false),
      tokens,
    }));
    return ran;
  }).catch(($, e, next) => next(e));

  // Claude Code's own run time, without the permission prompt and hooks.
  on("classic.PostToolUse", async ($, e, next) => {
    await recordExact($, e.tool_use_id, e.duration_ms);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("classic.PostToolUseFailure", async ($, e, next) => {
    await recordExact($, e.tool_use_id, e.duration_ms);
    return next(e);
  }).catch(($, e, next) => next(e));

  // A call drawn as its own row (ctrl+o, --verbose, a call the transcript does not fold).
  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    const row = await next(e);
    const { Box } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {row}
        {await callLine($, e, e.props, undefined, cwd)}
      </Box>
    );
  });

  // A folded run of calls keeps its summary line and gets one line per call.
  on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
    const row = await next(e);
    if (e.props.isExpanded) return row;
    const { Box } = $.ui.resolve(e);
    const lines = await Promise.all(
      e.props.calls.map((call) =>
        callLine($, e, call, callLabel(call.tool, call.input, cwd), cwd),
      ),
    );
    return (
      <Box flexDirection="column">
        {row}
        {lines}
      </Box>
    );
  });

  // The engine's own diff under an Edit or Write moves into the toggle, and
  // a Bash result loses its file diff (stdout stays). Ctrl+O, an error, or a
  // terminal without clicks keeps the engine's row.
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    const p = e.props;
    if (p.isErrored || p.isExpanded || !isClickable(e)) return next(e);
    if (diffsOf(p.tool, p.output).length === 0) return next(e);
    if (p.tool !== "Bash") {
      // Edit or Write: the toggle holds the whole diff
      const { Box } = $.ui.resolve(e);
      return <Box />;
    }
    // a partial Bash diff keeps the engine's note of the files it left out
    if (omittedFiles(p.tool, p.output) === 0) {
      const { bashEditDiff: _diff, ...rest } = p.output as Record<
        string,
        unknown
      >;
      return next({ ...e, props: { ...p, output: rest } });
    }
    return next(e);
  });
};
