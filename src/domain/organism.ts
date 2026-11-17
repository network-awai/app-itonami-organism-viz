/**
 * organism-viz pure core — TypeScript port (AWAI-3079) of
 * src/itonami_organism_viz/{aliveness,ideal_state,pruning}.cljk (themselves
 * ports of the Python modules). Only the pure functions are ported; the
 * directory scans that read a monorepo checkout are replaced by inputs the
 * person enters (see index.ts).
 *
 * Aliveness A(t) = ⟨M,D,C,P,G⟩ is a 5-tuple, never a scalar sum (§1.15).
 */

// ─── rounding: Python round(x, n), round-half-to-even (cljs branch) ───
// Faithful to the cljs branch: it scales first, so a value like 2.675 whose
// x·10^n lands exactly on .5 in floating point rounds to 2.68, where Python
// (which rounds the exact binary value) gives 2.67.
export function roundN(x: number, n: number): number {
  const p = Math.pow(10, n);
  const scaled = x * p;
  const fl = Math.floor(scaled);
  const diff = scaled - fl;
  const r = diff < 0.5 ? fl : diff > 0.5 ? fl + 1 : fl % 2 === 0 ? fl : fl + 1;
  return r / p;
}
export const round1 = (x: number) => roundN(x, 1);

// ─── aliveness ────────────────────────────────────────────────────────
export interface AliveTuple { M: number; D: number; C: number; P: number; G: number; timestamp: string; notes: string[] }

export function aliveTuple(M: number, D: number, C: number, P: number, G: number, timestamp = "", notes: string[] = []): AliveTuple {
  return { M, D, C, P, G, timestamp, notes: [...notes] };
}

export function asDict(a: AliveTuple) {
  return { M_motion: roundN(a.M, 4), D_diversity: roundN(a.D, 4), C_coupling: roundN(a.C, 4), P_pruning: roundN(a.P, 4), G_generational: roundN(a.G, 4), timestamp: a.timestamp, notes: [...a.notes] };
}

/** Per-dimension band membership — not a scalar pass/fail. */
export function inHealthyBand(a: Pick<AliveTuple, "M" | "D" | "C" | "P" | "G">) {
  return { M: a.M > 0.5, D: a.D > 1.5, C: a.C >= 0.2 && a.C <= 0.7, P: a.P >= 0.5 && a.P <= 1.0, G: a.G > 1.0 };
}

const AXIS_ROW = /^\|\s*\d+\s*\|\s*\*{0,2}([A-Za-z][A-Za-z\- ]*[A-Za-z])\*{0,2}[^|]*\|\s*\*{0,2}(\d+)\s*\/\s*10/gm;

/** Observation-cycle body → { axis name (lower-cased): score }. */
export function parseAxisTable(body: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of String(body ?? "").matchAll(AXIS_ROW)) out[m[1].trim().toLowerCase()] = parseInt(m[2], 10);
  return out;
}

export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  return -counts.reduce((acc, c) => { const p = c / total; return acc + p * Math.log(p); }, 0);
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  for (let i = 0; i < n; i++) num += (xs[i] - mx) * (ys[i] - my);
  const dx = Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, v) => s + (v - my) ** 2, 0));
  return dx > 0 && dy > 0 ? num / (dx * dy) : null;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

export type Cycle = [number, Record<string, number>];

/** [axis-M, transitions]: mean |Δ| over the union of axis keys across the last window+1 cycles. */
export function axisMotion(cycles: Cycle[], window: number): [number, number] {
  if (cycles.length < 2) return [0, 0];
  const recent = cycles.slice(-(window + 1));
  const deltas: number[] = [];
  for (let i = 0; i + 1 < recent.length; i++) {
    const a = recent[i][1], b = recent[i + 1][1];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deltas.push(Math.abs((b[k] ?? 0) - (a[k] ?? 0)));
  }
  return deltas.length ? [mean(deltas), recent.length - 1] : [0, 0];
}

/** [C, n-pairs]: mean pairwise Pearson r across axis trajectories; 0/0 under 3 cycles. */
export function couplingFrom(cycles: Cycle[]): [number, number] {
  if (cycles.length < 3) return [0, 0];
  const keys = [...new Set(cycles.flatMap(([, a]) => Object.keys(a)))].sort();
  const series = Object.fromEntries(keys.map((k) => [k, cycles.map(([, a]) => a[k] ?? 0)]));
  const corrs: number[] = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const r = pearson(series[keys[i]], series[keys[j]]);
    if (r !== null && !Number.isNaN(r)) corrs.push(r);
  }
  return corrs.length ? [mean(corrs), corrs.length] : [0, 0];
}

/** MGI proxy: 1.0 with LANDS present, +0.05 per 10 gen-marks, never capped; null without LANDS. */
export function generationalFrom(lands: boolean, genMarks: number): number | null {
  return lands ? 1.0 + 0.05 * Math.floor(genMarks / 10) : null;
}

// ─── ideal state: homeostatic ranges ─────────────────────────────────
export interface HomeostaticRange { name: string; symbol: string; lo: number | null; hi: number | null; unit: string; hard: boolean; deathSignature: string }
const range = (name: string, symbol: string, lo: number | null, hi: number | null, unit: string, hard: boolean, deathSignature: string): HomeostaticRange => ({ name, symbol, lo, hi, unit, hard, deathSignature });

export const RANGES: HomeostaticRange[] = [
  range("Council seats filled", "s_council", 5, 5, "seats", true, "<5 → constitutional crisis"),
  range("Substrate live", "s_substrate", 6, 7, "of 7", false, "≤3 → single-substrate dependency"),
  range("Charter Rider coverage", "r_rider", 0.95, 1.0, "ratio", false, "<0.80 → sanctification 崩壊"),
  range("Tithe ratio (exact)", "r_tithe", 0.10, 0.10, "ratio", true, "≠ 10% → 産霊 violation"),
  range("ADR velocity (30d avg)", "v_adr", 0.5, 5.0, "ADR/day", false, "=0 → stall; >5 → noise"),
  range("Tick cadence", "f_tick", 1.0 / 24, 24, "/day", false, "<1/wk → 縁起 broken"),
  range("Cell count (alive)", "n_cells", 30, 200, "cells", false, "<10 → 単純化; >500 → uncontrollable"),
  range("Cell pruning ratio (90d)", "r_prune", 0.05, 0.20, "ratio", false, "0% → bonsai 死; >40% → 焦土"),
  range("Sister-corps", "n_sister", 1, null, "corps", false, "=0 → reproduction unproven"),
  range("Members net flow", "dM_dt", 0, null, "/Q", true, "<0 impossible per §1.3"),
  range("Land alienation count", "n_alien", 0, 0, "events", true, ">0 → constitutional crisis"),
  range("MGI", "mgi", 1.0, null, "ratio", false, "≤1.0 → 子孫 priority breach"),
  range("Chaos rehearsals (Q)", "n_chaos", 1, null, "/Q", false, "=0/Y → anti-fragile decay"),
  range("Hard invariant violations", "n_viol", 0, 0, "events", true, "≥1 → Council convocation"),
  range("Eschatological content", "n_apoc", 0, 0, "items", true, "≥1 → §1.15 violation"),
];

export function inRange(r: HomeostaticRange, value: number): boolean {
  return !((r.lo !== null && value < r.lo) || (r.hi !== null && value > r.hi));
}

/** Signed deviation outside the band (0 inside; negative below lo, positive above hi). */
export function deviation(r: HomeostaticRange, value: number): number {
  if (r.lo !== null && value < r.lo) return value - r.lo;
  if (r.hi !== null && value > r.hi) return value - r.hi;
  return 0;
}

// ─── pruning candidates ──────────────────────────────────────────────
export interface Candidate { id: string; kind: "cell" | "app"; path: string; idle_days: number; severity: number; reasons: string[] }
export const CANDIDATE_FIELDS = ["id", "kind", "path", "idle_days", "severity", "reasons"];

export interface CellFacts { name: string; path: string; idleDays: number; hasCellPy: boolean; cellPyBytes: number; hasDocstring: boolean }
export interface AppFacts { name: string; path: string; idleDays: number; hasReadme: boolean }

/** scan_cells heuristics for one cell; null when it is not a candidate. */
export function assessCell(f: CellFacts): Candidate | null {
  const reasons: string[] = [];
  let sev = 0;
  if (f.idleDays > 90) { reasons.push(`idle ${Math.round(f.idleDays)} days (>90)`); sev = Math.max(sev, 2); }
  else if (f.idleDays > 30) { reasons.push(`idle ${Math.round(f.idleDays)} days (>30)`); sev = Math.max(sev, 1); }
  if (!f.hasCellPy) { reasons.push("no cell.py"); sev = Math.max(sev, 2); }
  else if (f.cellPyBytes < 200) { reasons.push("cell.py very small (<200 bytes)"); sev = Math.max(sev, 1); }
  else if (!f.hasDocstring) { reasons.push("no docstring"); sev = Math.max(sev, 1); }
  if (f.name.startsWith("yorishiro_") && f.idleDays > 60) { reasons.push("yorishiro idle >60 (exercise it or prune)"); sev = Math.max(sev, 1); }
  return sev > 0 ? { id: `cell/${f.name}`, kind: "cell", path: f.path, idle_days: round1(f.idleDays), severity: sev, reasons } : null;
}

/** scan_apps heuristics for one app; null when it is not a candidate. */
export function assessApp(f: AppFacts): Candidate | null {
  const reasons: string[] = [];
  let sev = 0;
  if (f.idleDays > 180) { reasons.push(`idle ${Math.round(f.idleDays)} days (>180)`); sev = 2; }
  else if (f.idleDays > 90) { reasons.push(`idle ${Math.round(f.idleDays)} days (>90)`); sev = 1; }
  if (f.idleDays > 30 && !f.hasReadme) { reasons.push("no README and stale"); sev = Math.max(sev, 1); }
  return sev > 0 ? { id: `app/${f.name}`, kind: "app", path: f.path, idle_days: round1(f.idleDays), severity: sev, reasons } : null;
}

export function sortCandidates(cs: Candidate[]): Candidate[] {
  return [...cs].sort((a, b) => b.severity - a.severity || b.idle_days - a.idle_days);
}

const HEADER = [
  "# Pruning Candidates", "",
  "**Daemon does not prune.** Per ADR-2605192100 §1.3, decision attribution = itonami. The list below is the daemon's honest observation; the operator decides what to `git rm`.",
  "",
];

export function toMarkdown(candidates: Candidate[]): string {
  if (candidates.length === 0) return [...HEADER, "_No candidates — the bonsai is currently in healthy growth without overgrowth._"].join("\n") + "\n";
  return [
    ...HEADER,
    `## ${candidates.length} candidate(s) — sorted by severity`, "",
    "| sev | id | path | idle (days) | reasons |", "|---|---|---|---|---|",
    ...candidates.map((c) => `| ${"🔴".repeat(c.severity)}${"·".repeat(3 - c.severity)} | \`${c.id}\` | \`${c.path}\` | ${c.idle_days} | ${c.reasons.join("; ")} |`),
    "", "## Operator pruning protocol", "", "```",
    "# 1. Review the candidate (open the directory, read the docstring)",
    "# 2. If 'intentional dormancy', annotate in CLAUDE.md or the path README",
    "# 3. Otherwise:", "git rm -r <path>", "git commit -m 'prune: <id> — <reason>'",
    "# 4. Document in 90-docs/pruning/<YYMMDD>-<id>.md", "```", "",
  ].join("\n");
}
