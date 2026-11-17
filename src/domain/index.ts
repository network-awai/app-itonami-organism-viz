/**
 * organism-viz — local aliveness / ideal-state / pruning workbench (AWAI-3079).
 *
 * The former tool scanned a monorepo checkout (observation files, cells, apps)
 * from a Python/Clojure host. A sandboxed app has no filesystem access, so the
 * inputs are entered here: observation-cycle texts, cell/app facts and the
 * observed values. The math is the ported pure core in organism.ts.
 */
import type { LocalStore } from "../local-store.js";
import { getOne, idSlug, isNonEmpty, listAll, nowISO, put } from "./records.js";
import {
  aliveTuple, asDict, assessApp as assessAppPure, assessCell as assessCellPure, axisMotion, couplingFrom, deviation, generationalFrom, inHealthyBand,
  inRange, parseAxisTable, RANGES, shannonEntropy, sortCandidates, toMarkdown, type Candidate, type Cycle,
} from "./organism.js";

export { roundN, round1, aliveTuple, asDict, inHealthyBand, parseAxisTable, shannonEntropy, pearson, mean, axisMotion, couplingFrom, generationalFrom, RANGES, inRange, deviation, sortCandidates, toMarkdown, CANDIDATE_FIELDS } from "./organism.js";
export { assessCellPure, assessAppPure };

export const CYCLE = "cloud.itonami.apps.organismViz.cycle";
export const SNAPSHOT = "cloud.itonami.apps.organismViz.aliveness";
export const CANDIDATE = "cloud.itonami.apps.organismViz.pruningCandidate";

export interface RecordCycleInput { cycleNumber: number; body: string }
export interface ComputeAlivenessInput { snapshotId: string; cellCount: number; tendedCells: number; landsPresent?: boolean; genMarks?: number; creationPerDay?: number; window?: number }
export interface CheckIdealStateInput { symbol: string; value: number }
export interface AssessCellInput { name: string; path: string; idleDays: number; hasCellPy?: boolean; cellPyBytes?: number; hasDocstring?: boolean }
export interface AssessAppInput { name: string; path: string; idleDays: number; hasReadme?: boolean }

const cycleKey = (n: number) => `cycle-${String(n).padStart(6, "0")}`;

export async function recordCycle(e: LocalStore, input: RecordCycleInput) {
  if (!Number.isInteger(input.cycleNumber) || input.cycleNumber < 0) return { status: "rejected", error: "cycleNumberMustBeNonNegativeInteger" };
  const axes = parseAxisTable(input.body);
  if (Object.keys(axes).length === 0) return { status: "rejected", error: "noAxisTable", hint: "| 1 | **Motion** | 7 / 10 | のような行が必要です" };
  await put(e, CYCLE, cycleKey(input.cycleNumber), { cycleNumber: input.cycleNumber, axes, recordedAt: nowISO() });
  return { status: "recorded", cycleNumber: input.cycleNumber, axes };
}

async function cycles(e: LocalStore): Promise<Cycle[]> {
  return (await listAll<{ cycleNumber: number; axes: Record<string, number> }>(e, CYCLE)).map((r) => [r.value.cycleNumber, r.value.axes] as Cycle).sort((a, b) => a[0] - b[0]);
}

export async function computeAliveness(e: LocalStore, input: ComputeAlivenessInput) {
  if (!isNonEmpty(input.snapshotId)) return { status: "rejected", error: "missingRequiredFields" };
  if (!Number.isInteger(input.cellCount) || input.cellCount < 0 || !Number.isInteger(input.tendedCells) || input.tendedCells < 0) return { status: "rejected", error: "countsMustBeNonNegativeIntegers" };
  if (input.tendedCells > input.cellCount) return { status: "rejected", error: "tendedExceedsCells" };
  const window = input.window ?? 7;
  const cs = await cycles(e);
  const [axisM, transitions] = axisMotion(cs, window);
  const creation = input.creationPerDay ?? 0;
  const M = axisM + 0.3 * creation;
  const D = input.cellCount > 0 ? shannonEntropy(Array(input.cellCount).fill(1)) : 0;
  const [C, pairs] = couplingFrom(cs);
  const P = input.cellCount > 0 ? input.tendedCells / input.cellCount : 0;
  const G = generationalFrom(!!input.landsPresent, input.genMarks ?? 0) ?? 0;
  const notes = [
    `motion: axis_Δ=${axisM.toFixed(3)}/cycle (${transitions} transitions) + 0.3·creation=${creation.toFixed(2)}/day → M=${M.toFixed(3)}`,
    input.cellCount > 0 ? `diversity: H = ${D.toFixed(3)} nats over ${input.cellCount} distinct cells (八百万)` : "diversity: no cells",
    cs.length < 3 ? "coupling: <3 cycles → undefined; returning 0" : pairs ? `coupling: mean pairwise r = ${C.toFixed(3)} across ${pairs} axis pairs` : "coupling: no valid correlations",
    input.cellCount > 0 ? `pruning: ${input.tendedCells}/${input.cellCount} cells documented → P=${P.toFixed(3)}` : "pruning: 0 cells",
    input.landsPresent ? `generational: gen_marks=${input.genMarks ?? 0} → MGI≈${G.toFixed(3)}` : "generational: LANDS.md missing → MGI undefined",
  ];
  const a = aliveTuple(M, D, C, P, G, nowISO(), notes);
  const snapshot = { snapshotId: input.snapshotId, ...asDict(a), healthyBand: inHealthyBand(a), cycles: cs.length };
  await put(e, SNAPSHOT, `aliveness-${idSlug(input.snapshotId)}`, snapshot);
  return { status: "computed", ...snapshot };
}

export async function checkIdealState(e: LocalStore, input: CheckIdealStateInput) {
  const r = RANGES.find((x) => x.symbol === input.symbol);
  if (!r) return { status: "rejected", error: "unknownSymbol", symbols: RANGES.map((x) => x.symbol) };
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) return { status: "rejected", error: "valueMustBeNumber" };
  const ok = inRange(r, input.value);
  return { status: "ok", range: r, value: input.value, inRange: ok, deviation: deviation(r, input.value), crisis: !ok && r.hard, deathSignature: ok ? null : r.deathSignature };
}

export async function listRanges(_e: LocalStore) {
  return { items: RANGES, total: RANGES.length };
}

async function saveCandidate(e: LocalStore, c: Candidate | null, id: string) {
  if (!c) return { status: "notACandidate", id };
  await put(e, CANDIDATE, `cand-${idSlug(c.id)}`, c);
  return { status: "candidate", candidate: c };
}

export async function assessCell(e: LocalStore, input: AssessCellInput) {
  if (!isNonEmpty(input.name) || !isNonEmpty(input.path) || typeof input.idleDays !== "number" || input.idleDays < 0) return { status: "rejected", error: "missingRequiredFields" };
  return saveCandidate(e, assessCellPure({ name: input.name, path: input.path, idleDays: input.idleDays, hasCellPy: !!input.hasCellPy, cellPyBytes: input.cellPyBytes ?? 0, hasDocstring: !!input.hasDocstring }), `cell/${input.name}`);
}

export async function assessApp(e: LocalStore, input: AssessAppInput) {
  if (!isNonEmpty(input.name) || !isNonEmpty(input.path) || typeof input.idleDays !== "number" || input.idleDays < 0) return { status: "rejected", error: "missingRequiredFields" };
  return saveCandidate(e, assessAppPure({ name: input.name, path: input.path, idleDays: input.idleDays, hasReadme: !!input.hasReadme }), `app/${input.name}`);
}

export async function pruningReport(e: LocalStore) {
  const cs = sortCandidates((await listAll<Candidate>(e, CANDIDATE)).map((r) => r.value));
  return { status: "ok", total: cs.length, markdown: toMarkdown(cs) };
}
