import { expect, test } from "vitest";
import { designContent, emptyDesign } from "./model/designs";
import { legendEntries, legendHeight, setLegendMeaning } from "./model/design-legend";
import { designLayout, shiftDesign, setLaneOrientation } from "./design-layout";

const fixture = () => designContent.parse({
  ...emptyDesign("Legend demo", "system"),
  nodes: [{ id: "a", title: "A", comment: "", groupId: null, x: 80, y: 80, color: "#EF4444" }, { id: "b", title: "B", comment: "", groupId: null, x: 400, y: 80, color: "#ef4444" }],
  links: [
    { id: "default", from: "a", to: "b", label: "" },
    { id: "red", from: "a", to: "b", label: "", color: "#EF4444" },
    { id: "red-duplicate", from: "a", to: "b", label: "", color: "#ef4444" },
    { id: "dashed-red", from: "a", to: "b", label: "", color: "#ef4444", style: "dashed" },
    { id: "dashed-default", from: "a", to: "b", label: "", style: "dashed" },
  ],
  legend: { x: 200, y: 900, meanings: [] },
});

test("legend omits defaults and deduplicates line pairs independently of node colors", () => {
  expect(legendEntries(fixture())).toEqual([
    { kind: "line", style: "solid", color: "#ef4444", text: "" },
    { kind: "line", style: "dashed", color: "#ef4444", text: "" },
    { kind: "line", style: "dashed", text: "" },
    { kind: "node", color: "#ef4444", text: "" },
  ]);
});
test("legend meanings persist when a variation disappears and returns", () => {
  const content = fixture(), entry = legendEntries(content)[1];
  const updated = setLegendMeaning(content, entry, "Retries");
  const removed = { ...updated, links: updated.links.filter((link) => link.id !== "dashed-red") };
  expect(legendEntries(removed).some((item) => item.text === "Retries")).toBe(false);
  expect(legendEntries({ ...removed, links: updated.links })[1].text).toBe("Retries");
  expect(setLegendMeaning(updated, entry, "Async retries").legend?.meanings).toHaveLength(1);
});
test("fitting allows for multiline and long legend meanings", () => {
  const content = fixture(), entry = legendEntries(content)[0];
  expect(legendHeight(setLegendMeaning(content, entry, Array(40).fill("A paragraph").join("\n")))).toBeGreaterThan(1000);
  expect(legendHeight(setLegendMeaning(content, entry, "W".repeat(2000)))).toBeGreaterThan(1800);
});
test("legend is included in fitting, shifted with the canvas and independent of lane direction", () => {
  const content = fixture(), layout = designLayout(content);
  expect(layout.height).toBeGreaterThan(1200);
  expect(shiftDesign(content, { kind: "node", id: "a" }, 40, 50).legend).toEqual({ ...content.legend, x: 240, y: 950 });
  expect(shiftDesign(content, { kind: "legend", id: "legend" }, 40, 50).legend).toEqual(content.legend);
  const lanes = { ...emptyDesign("Flow", "swimlane"), legend: content.legend };
  expect(setLaneOrientation(lanes, "vertical").legend).toEqual(content.legend);
});
test("color and legend data are additive, strict, and reject ambiguous meanings", () => {
  const content = fixture();
  expect(designContent.safeParse(emptyDesign("Legacy", "system")).success).toBe(true);
  for (const invalid of [
    { ...content, nodes: [{ ...content.nodes[0], color: "yellow" }] },
    { ...content, legend: { x: -1, y: 80, meanings: [] } },
    { ...content, legend: { x: 80, y: 80, meanings: [{ kind: "node", text: "Bad" }] } },
    { ...content, legend: { x: 80, y: 80, meanings: [{ kind: "node", color: "#ffffff", style: "dashed", text: "Bad" }] } },
    { ...content, legend: { x: 80, y: 80, meanings: [{ kind: "node", color: "#FFFFFF", text: "One" }, { kind: "node", color: "#ffffff", text: "Two" }] } },
  ]) expect(designContent.safeParse(invalid).success).toBe(false);
});
