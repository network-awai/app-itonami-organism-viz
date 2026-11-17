// Ported from test/itonami_organism_viz/*_test.cljk (pure assertions kept with the
// same numbers), plus the file-scan cases re-expressed through the local inputs.
import { describe, it, beforeEach } from "node:test";
import { expect } from "./expect.mjs";
import { LocalStore } from "../dist/local-store.js";
import {
  RANGES, inRange, deviation, round1, roundN, aliveTuple, asDict, inHealthyBand, parseAxisTable, toMarkdown, CANDIDATE_FIELDS,
  assessCellPure, recordCycle, computeAliveness, checkIdealState, assessCell, assessApp, pruningReport,
} from "../dist/domain/index.js";

const approx = (a: number, b: number) => expect(Math.abs(a - b) < 1e-9).toBe(true);
const cycle = (rows: Array<[string, number]>) => rows.map(([n, s], i) => `| ${i + 1} | **${n}** | ${s} / 10 |`).join("\n");

describe("ideal_state (ported)", () => {
  it("has the 15 ranges", () => {
    expect(RANGES.length).toBe(15);
    expect(RANGES[0].symbol).toBe("s_council");
  });
  it("in-range bounds, unbounded above", () => {
    const council = RANGES.find((r: any) => r.symbol === "s_council");
    const sister = RANGES.find((r: any) => r.symbol === "n_sister");
    expect(inRange(council, 5)).toBe(true);
    expect(inRange(council, 4)).toBe(false);
    expect(inRange(council, 6)).toBe(false);
    expect(inRange(sister, 1000000)).toBe(true);
    expect(inRange(sister, 0)).toBe(false);
  });
  it("deviation sign", () => {
    const council = RANGES.find((r: any) => r.symbol === "s_council");
    expect(deviation(council, 5)).toBe(0);
    expect(deviation(council, 4)).toBe(-1);
    expect(deviation(council, 6)).toBe(1);
  });
});

describe("pruning (ported)", () => {
  it("candidate shape and field order", () => {
    const c = assessCellPure({ name: "x", path: "20-actors/x", idleDays: 100, hasCellPy: false, cellPyBytes: 0, hasDocstring: false });
    expect(Object.keys(c).join()).toBe(CANDIDATE_FIELDS.join());
    expect(c.severity).toBe(2);
  });
  it("round1 is half-even", () => {
    expect(round1(91.34)).toBe(91.3);
    expect(round1(91.37)).toBe(91.4);
    expect(round1(5.0)).toBe(5);
    expect(round1(0)).toBe(0);
    expect(round1(199.96)).toBe(200);
  });
  it("renders markdown for empty and non-empty lists", () => {
    const empty = toMarkdown([]);
    expect(empty.includes("# Pruning Candidates")).toBe(true);
    expect(empty.includes("Daemon does not prune")).toBe(true);
    expect(empty.includes("healthy growth")).toBe(true);
    const md = toMarkdown([{ id: "cell/stale", kind: "cell", path: "20-actors/stale", idle_days: 120, severity: 3, reasons: ["idle"] }]);
    expect(md.includes("1 candidate(s)")).toBe(true);
    expect(md.includes("`cell/stale`")).toBe(true);
    expect(md.includes("`20-actors/stale`")).toBe(true);
    expect(md.includes("🔴🔴🔴")).toBe(true);
    expect(md.includes("git rm -r")).toBe(true);
  });
});

describe("aliveness (ported)", () => {
  it("as-dict rounds to 4 dp", () => {
    const d = asDict(aliveTuple(1.23456, 0, 0, 0, 1.1, "", ["x"]));
    expect(d.M_motion).toBe(1.2346);
    expect(d.G_generational).toBe(1.1);
    expect(d.notes.join()).toBe("x");
  });
  it("healthy-band thresholds per dimension", () => {
    const b = inHealthyBand({ M: 0.6, D: 1.6, C: 0.5, P: 0.7, G: 1.05 });
    expect(Object.values(b).every(Boolean)).toBe(true);
    expect(inHealthyBand({ M: 0.5, D: 1.5, C: 0.8, P: 0.4, G: 1.0 }).C).toBe(false);
  });
  it("parses axis tables with lower-cased names", () => {
    expect(JSON.stringify(parseAxisTable(cycle([["Motion", 7], ["Diversity", 5]])))).toBe('{"motion":7,"diversity":5}');
    expect(roundN(0.125, 2)).toBe(0.12); // exact tie → even (Python round agrees)
    expect(roundN(0.375, 2)).toBe(0.38);
  });
});

describe("organism-viz workbench", () => {
  let e: any;
  beforeEach(() => { e = new LocalStore({ did: "did:web:organism-viz.itonami.cloud" }); });

  it("motion is the mean axis delta; coupling +1 for co-moving axes", async () => {
    await recordCycle(e, { cycleNumber: 1, body: cycle([["Motion", 1], ["Diversity", 2]]) });
    await recordCycle(e, { cycleNumber: 2, body: cycle([["Motion", 3], ["Diversity", 4]]) });
    await recordCycle(e, { cycleNumber: 3, body: cycle([["Motion", 6], ["Diversity", 7]]) });
    const a = await computeAliveness(e, { snapshotId: "s1", cellCount: 4, tendedCells: 2, landsPresent: true, genMarks: 20 });
    approx(a.M_motion, 2.5); // deltas 2,2,3,3 → mean 2.5
    approx(a.C_coupling, 1);
    approx(a.D_diversity, roundN(Math.log(4), 4));
    approx(a.P_pruning, 0.5);
    approx(a.G_generational, 1.1);
  });

  it("coupling is -1 for opposed axes and undefined under 3 cycles", async () => {
    await recordCycle(e, { cycleNumber: 1, body: cycle([["Up", 1], ["Down", 9]]) });
    await recordCycle(e, { cycleNumber: 2, body: cycle([["Up", 5], ["Down", 5]]) });
    expect((await computeAliveness(e, { snapshotId: "a", cellCount: 0, tendedCells: 0 })).C_coupling).toBe(0);
    await recordCycle(e, { cycleNumber: 3, body: cycle([["Up", 9], ["Down", 1]]) });
    approx((await computeAliveness(e, { snapshotId: "b", cellCount: 0, tendedCells: 0 })).C_coupling, -1);
    expect((await recordCycle(e, { cycleNumber: 4, body: "no table" })).error).toBe("noAxisTable");
    expect((await computeAliveness(e, { snapshotId: "c", cellCount: 1, tendedCells: 2 })).error).toBe("tendedExceedsCells");
    expect((await computeAliveness(e, { snapshotId: "d", cellCount: 1, tendedCells: 0 })).G_generational).toBe(0);
  });

  it("checks observed values against the homeostatic ranges", async () => {
    const r = await checkIdealState(e, { symbol: "n_viol", value: 1 });
    expect(r.inRange).toBe(false);
    expect(r.crisis).toBe(true);
    expect((await checkIdealState(e, { symbol: "v_adr", value: 2 })).inRange).toBe(true);
    expect((await checkIdealState(e, { symbol: "nope", value: 1 })).error).toBe("unknownSymbol");
  });

  it("collects pruning candidates and renders the report sorted by severity", async () => {
    expect((await assessCell(e, { name: "fresh", path: "c/fresh", idleDays: 2, hasCellPy: true, cellPyBytes: 900, hasDocstring: true })).status).toBe("notACandidate");
    await assessCell(e, { name: "tiny", path: "c/tiny", idleDays: 40, hasCellPy: true, cellPyBytes: 50, hasDocstring: true });
    await assessApp(e, { name: "ghost", path: "60-apps/ghost", idleDays: 200, hasReadme: false });
    const rep = await pruningReport(e);
    expect(rep.total).toBe(2);
    expect(rep.markdown.indexOf("app/ghost") < rep.markdown.indexOf("cell/tiny")).toBe(true);
    expect(rep.markdown.includes("no README and stale")).toBe(true);
  });
});
