/** One finding, as Codex's review-output.schema.json spells it */
export type CxFinding = {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  file: string;
  line_start: number;
  line_end: number;
  confidence: number;
  recommendation: string;
};

export type CxReview = {
  verdict: "approve" | "needs-attention";
  summary: string;
  findings: CxFinding[];
  next_steps: string[];
};

export type CxMode = "adversarial" | "standard";

/** What a review covers: the branch against its base, the commits since the session started, or the uncommitted changes */
export type CxScope = "base" | "session" | "changes";

export type CxJob = {
  id: string;
  mode: CxMode;
  repo: string;
  root: string;
  /** The --base ref: the base branch, the session's start commit, or HEAD for uncommitted changes */
  base: string;
  /** Absent on jobs from before scopes: those are "base" */
  scope?: CxScope;
  focus: string;
  /** Where the detached companion writes out.json and err.log */
  dir: string;
  pid: number;
  startedAt: number;
  endedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  /** The companion's own phase while running ("starting", "reviewing", ...) */
  phase?: string;
  /** Started by Claude's CodexReview tool, not by /cx */
  byTool: boolean;
  review?: CxReview;
  /** Codex's text where there is no structured review (standard mode, a parse error) */
  raw?: string;
  error?: string;
};

export type CxState = {
  jobs: CxJob[];
  /** The job whose findings the pane shows */
  shown?: string;
  /** Which of the shown job's findings are ticked */
  picked: boolean[];
  /** The repository and its HEAD when the session started: where "Session commits" begin */
  sessionHead?: { root: string; sha: string };
};

declare module "claude-code" {
  interface PluginState {
    "codex-review": { cx: CxState };
  }
}
