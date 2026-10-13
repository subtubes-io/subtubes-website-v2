"use client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { reportSwimlanes } from "./model/report-swimlanes";
import { swimlaneFixture } from "../../test/fixtures/report-swimlanes";
import { normalizeReport } from "./report-utils";
import { reportFixture } from "./fixtures";
import { ReportTabs } from "./ReportTabs";
import { ReportSwimlanes } from "./ReportSwimlanes";
import { reportServices } from "./services";

test("embedded diagrams preserve full Designs content through report normalization and JSON transfer", () => {
  const swimlanes = [swimlaneFixture(), swimlaneFixture("vertical")];
  const transferred = normalizeReport(JSON.parse(JSON.stringify({ report: { ...reportFixture(), swimlanes } })));
  expect(typeof transferred).toBe("object");
  if (typeof transferred !== "string") expect(transferred.swimlanes).toEqual(swimlanes);
  const legacy = normalizeReport(reportFixture());
  if (typeof legacy !== "string") expect(legacy.swimlanes).toBeUndefined();
});

test("invalid and unsafe diagrams are rejected rather than discarded", () => {
  const diagram = swimlaneFixture();
  const invalids = [
    null, {}, [diagram, diagram], Array(21).fill(diagram),
    [{ ...diagram, source: { designId: "../unsafe", revision: 1, name: "x", snapshotAt: new Date().toISOString() } }],
    [{ ...diagram, source: { designId: "d", revision: 0, name: "x", snapshotAt: new Date().toISOString() } }],
    [{ ...diagram, content: { ...diagram.content, nodes: [{ ...diagram.content.nodes[0], groupId: null }] } }],
    [{ ...diagram, content: { ...diagram.content, nodes: [{ ...diagram.content.nodes[0], x: -1 }] } }],
    [{ ...diagram, content: { ...diagram.content, nodes: [{ ...diagram.content.nodes[0], color: "red" }] } }],
    [{ ...diagram, content: { ...diagram.content, links: [{ id: "bad", from: "step-0", to: "missing", label: "" }] } }],
    [{ ...diagram, content: { ...diagram.content, groups: [diagram.content.groups[0], diagram.content.groups[0]] } }],
    [{ ...diagram, content: { ...diagram.content, nodes: [{ ...diagram.content.nodes[0], fileRefs: [{ file: "../secret.ts" }] }] } }],
    [{ ...diagram, content: { ...diagram.content, nodes: [{ ...diagram.content.nodes[0], fileRefs: [{ file: "src/a.ts", line: 0 }] }] } }],
  ];
  for (const swimlanes of invalids) {
    expect(reportSwimlanes.safeParse(swimlanes).success).toBe(false);
    expect(normalizeReport({ ...reportFixture(), swimlanes })).toBe("This report has invalid swimlane diagrams.");
  }
});

test("the combined diagram byte limit accepts 2 MB and rejects content above it", () => {
  const base = swimlaneFixture();
  const diagrams = Array.from({ length: 4 }, (_, index) => ({ ...base, id: `size-${index}`, content: {
    ...base.content,
    groups: base.content.groups.map(group => ({ ...group, comment: "x".repeat(20000) })),
    nodes: Array.from({ length: 20 }, (_, node) => ({ ...base.content.nodes[0], id: `size-node-${node}`, comment: "x".repeat(20000) })),
    links: [],
  } }));
  const bytes = () => new TextEncoder().encode(JSON.stringify(diagrams)).byteLength;
  let excess = bytes() - 2_000_000;
  for (const node of diagrams[0].content.nodes) {
    const trim = Math.min(excess, node.comment.length);
    node.comment = node.comment.slice(trim);
    excess -= trim;
  }
  expect(bytes()).toBe(2_000_000);
  expect(reportSwimlanes.safeParse(diagrams).success).toBe(true);
  diagrams[0].content.nodes[0].comment += "x";
  expect(bytes()).toBe(2_000_001);
  const result = reportSwimlanes.safeParse(diagrams);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.some(issue => issue.message.includes("2 MB"))).toBe(true);
});

test("the Design chapter is offered without a count and has no second menu", () => {
  render(<ReportTabs config={{ active: "design", onSelect: vi.fn() }} />);
  expect(screen.queryByRole("group", { name: "Design views" })).toBeNull();
  expect(screen.getByRole("button", { name: "Design" }).getAttribute("aria-pressed")).toBe("true");
});

test("a report with no diagram invites the reviewer to pick a saved design, and tells them why", () => {
  render(<ReportSwimlanes diagrams={[]} files={[]} onAttach={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "No design is attached to this report" })).toBeTruthy();
  expect(screen.getByText(/frozen copy/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Pick a design" }) as HTMLButtonElement).disabled).toBe(false);
});

test("a report that is not saved to a project cannot take designs", () => {
  render(<ReportSwimlanes diagrams={[]} files={[]} />);
  expect((screen.getByRole("button", { name: "Pick a design" }) as HTMLButtonElement).disabled).toBe(true);
});

const summary = (id: string, name: string, revision: number, extra = {}) => ({ id, revision, name, kind: "swimlane" as const, description: "", nodes: 3, groups: 2, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z", ...extra });

test("picking designs copies each as a snapshot, and shows what is already in the report", async () => {
  const user = userEvent.setup();
  const list = vi.spyOn(reportServices, "designs").mockResolvedValue({ designs: [summary("one", "Checkout flow", 2), summary("two", "Order system", 1, { kind: "system" })] });
  const onAttach = vi.fn(async () => undefined);
  const taken = { ...swimlaneFixture(), source: { designId: "one", revision: 2, name: "Checkout flow", snapshotAt: "2026-10-03T00:00:00.000Z" } };
  render(<ReportSwimlanes diagrams={[taken]} files={[]} onAttach={onAttach} onRemove={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add design" }));
  const picker = await screen.findByRole("dialog", { name: "Add designs to this report" });
  expect(await within(picker).findByText("Checkout flow")).toBeTruthy();
  expect(within(picker).getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual(["Select", "Name", "Type"]);
  expect((within(picker).getByRole("checkbox", { name: "Select Checkout flow" }) as HTMLInputElement).disabled).toBe(true);
  expect(within(picker).getByRole("cell", { name: "System" })).toBeTruthy();
  expect(within(picker).getByRole("cell", { name: "Swimlane" })).toBeTruthy();
  expect(within(picker).queryByText(/revision|steps|updated/)).toBeNull();
  await user.click(within(picker).getByRole("checkbox", { name: "Select Order system" }));
  await user.click(within(picker).getByRole("button", { name: "Add design" }));
  expect(onAttach).toHaveBeenCalledWith("two");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add designs to this report" })).toBeNull());
  expect(list).toHaveBeenCalled();
});

test("the picker filters designs by name as you type and says when nothing matches", async () => {
  const user = userEvent.setup();
  vi.spyOn(reportServices, "designs").mockResolvedValue({ designs: [summary("one", "Checkout flow", 1), summary("two", "Order system", 1, { kind: "system" }), summary("three", "Checkout refunds", 1)] });
  render(<ReportSwimlanes diagrams={[]} files={[]} onAttach={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Pick a design" }));
  const picker = await screen.findByRole("dialog", { name: "Add designs to this report" });
  await within(picker).findByText("Order system");
  expect(document.activeElement).toBe(within(picker).getByRole("searchbox", { name: "Search designs by name" }));
  await user.type(within(picker).getByRole("searchbox"), "CHECKOUT");
  expect(within(picker).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["Checkout flow", "Checkout refunds"]);
  await user.click(within(picker).getByRole("row", { name: /Checkout refunds/ }));
  expect((within(picker).getByRole("checkbox", { name: "Select Checkout refunds" }) as HTMLInputElement).checked).toBe(true);
  await user.type(within(picker).getByRole("searchbox"), "zzz");
  expect(within(picker).getByText(/No designs match/)).toBeTruthy();
});

test("a snapshot names the design it came from and says if the design has changed since, without revision numbers", async () => {
  vi.spyOn(reportServices, "designs").mockResolvedValue({ designs: [summary("one", "Checkout flow", 5)] });
  const diagram = { ...swimlaneFixture(), source: { designId: "one", revision: 2, name: "Checkout flow", snapshotAt: "2026-10-03T00:00:00.000Z" } };
  render(<ReportSwimlanes diagrams={[diagram]} files={[]} onAttach={vi.fn()} onRemove={vi.fn()} />);
  const source = screen.getByLabelText("Diagram source");
  expect(source.textContent).toMatch(/Checkout flow · taken /);
  expect(source.textContent).not.toMatch(/revision|[Ff]rozen/);
  await waitFor(() => expect(source.textContent).toMatch(/The design has changed since/));
  expect(within(source).getByRole("button", { name: "Remove from report" })).toBeTruthy();
});

test("a diagram is removed only after confirming, and a refusal from the service is shown", async () => {
  const user = userEvent.setup();
  vi.spyOn(reportServices, "designs").mockResolvedValue({ designs: [] });
  const ask = vi.spyOn(reportServices, "ask").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onRemove = vi.fn().mockRejectedValue(new Error("2 active decisions are anchored to this diagram."));
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} onAttach={vi.fn()} onRemove={onRemove} />);
  await user.click(screen.getByRole("button", { name: "Remove from report" }));
  expect(onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove from report" }));
  expect(ask).toHaveBeenCalledTimes(2);
  expect((await screen.findByRole("alert")).textContent).toMatch(/anchored to this diagram/);
});

test("a system diagram shows in the report without lane direction or layout controls", () => {
  const system = { id: "sys", content: { name: "Order system", kind: "system" as const, description: "", groups: [], links: [], nodes: [{ id: "api", title: "API", comment: "Entry point", groupId: null, x: 40, y: 40 }] } };
  render(<ReportSwimlanes diagrams={[system]} files={[]} onSaveLayout={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "Lane direction" })).toBeNull();
  expect(screen.getByRole("button", { name: "Select node API" })).toBeTruthy();
});

test("read-only canvases switch diagrams and show complete Markdown details without edit controls", async () => {
  vi.spyOn(reportServices, "writeText").mockResolvedValue();
  const diagrams = [swimlaneFixture(), swimlaneFixture("vertical")];
  const { container } = render(<ReportSwimlanes diagrams={diagrams} />);
  await userEvent.click(screen.getByRole("button", { name: "Select node Validate order" }));
  expect(screen.queryByRole("complementary", { name: "Swimlane details" })).toBeNull();
  await userEvent.dblClick(screen.getByText("Validate order", { selector: "strong" }));
  const drawer = screen.getByRole("dialog", { name: "Node details: Validate order" });
  expect(screen.queryByRole("complementary", { name: "Swimlane details" })).toBeNull();
  expect(drawer.textContent).toContain("Synthetic evidence: service.ts:12.");
  expect(drawer.querySelector("code.language-ts")).not.toBeNull();
  expect(within(drawer).queryByRole("textbox")).toBeNull();
  expect(within(drawer).queryByRole("button", { name: "Edit" })).toBeNull();
  await userEvent.click(within(drawer).getByRole("button", { name: "Copy Markdown" }));
  expect(reportServices.writeText).toHaveBeenLastCalledWith(expect.stringContaining("const validated = validate(order);"));
  await userEvent.click(within(drawer).getByRole("button", { name: "Copy node ID" }));
  expect(reportServices.writeText).toHaveBeenLastCalledWith("step-2");
  await userEvent.click(within(drawer).getByRole("button", { name: "Copy diagram ID" }));
  expect(reportServices.writeText).toHaveBeenLastCalledWith("horizontal");
  await userEvent.click(within(drawer).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  await userEvent.keyboard("{Delete}");
  expect(diagrams[0].content.nodes).toHaveLength(5);
  await userEvent.click(screen.getByRole("button", { name: "Receipt flow" }));
  expect(screen.queryByRole("complementary", { name: "Swimlane details" })).toBeNull();
  expect(container.querySelector(".design-group.vertical")).not.toBeNull();
});

test("report nodes show their status icon and the read-only drawer shows the status without controls", async () => {
  const diagram = swimlaneFixture();
  diagram.content.nodes = diagram.content.nodes.map((node, index) => index === 2 ? { ...node, status: "completed" as const } : index === 3 ? { ...node, status: "in-progress" as const } : node);
  render(<ReportSwimlanes diagrams={[diagram]} />);
  const header = (title: string) => screen.getByText(title, { selector: "strong" });
  expect(header("Validate order").querySelector("svg.completed")?.getAttribute("aria-label")).toBe("Status: Completed");
  expect(header("Save order").querySelector("svg.in-progress")?.getAttribute("aria-label")).toBe("Status: In progress");
  expect(header("Click checkout").querySelector("svg")).toBeNull();
  await userEvent.dblClick(header("Validate order"));
  const drawer = screen.getByRole("dialog", { name: "Node details: Validate order" });
  expect(within(drawer).getByText("Completed")).toBeTruthy();
  expect(within(drawer).queryByRole("group", { name: "Implementation status" })).toBeNull();
});

test("lanes open details on double click or Enter and file references call the shared drawer action", async () => {
  const open = vi.fn();
  const { container } = render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={["src/a.ts", "src/b.ts"]} onOpenFile={open} />);
  await userEvent.click(screen.getByRole("button", { name: "src/b.ts" }));
  expect(open).toHaveBeenLastCalledWith("src/b.ts");
  expect(screen.queryByRole("complementary")).toBeNull();
  const lane = screen.getByRole("button", { name: "Select lane Service" });
  await userEvent.click(lane);
  expect(screen.queryByRole("complementary")).toBeNull();
  await userEvent.dblClick(lane);
  const details = screen.getByRole("complementary", { name: "Swimlane details" });
  expect(details.textContent).toContain("Service stage");
  await userEvent.click(screen.getAllByRole("button", { name: "src/b.ts" }).at(-1)!);
  expect(open).toHaveBeenLastCalledWith("src/b.ts");
  await userEvent.click(screen.getByRole("button", { name: "Close swimlane details" }));
  const node = screen.getByRole("button", { name: "Select node Validate order" });
  node.focus();
  await userEvent.keyboard("{Enter}");
  const drawer = screen.getByRole("dialog", { name: "Node details: Validate order" });
  expect(drawer.textContent).toContain("missing.ts — No saved diff available");
  await userEvent.click(within(drawer).getByRole("button", { name: "src/a.ts:10" }));
  expect(open).toHaveBeenLastCalledWith("src/a.ts");
  expect(screen.queryByRole("dialog")).toBeNull();
});


test("a saved diagram's steps and lanes can be resized by keyboard and the new size is saved", async () => {
  const onSaveLayout = vi.fn().mockResolvedValue(undefined);
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} onSaveLayout={onSaveLayout} />);
  const grow = (name: string, key: string) => { const handle = screen.getByRole("button", { name }) as HTMLButtonElement; expect(handle.disabled).toBe(false); fireEvent.keyDown(handle, { key }); };
  grow("Resize node Click checkout from bottom-right", "ArrowRight");
  await waitFor(() => expect(onSaveLayout).toHaveBeenCalledTimes(1));
  expect(onSaveLayout.mock.calls[0][1].nodes[0]).toMatchObject({ id: "step-0", width: 250, height: 144 });
  grow("Resize lane User from bottom-right", "ArrowDown");
  await waitFor(() => expect(onSaveLayout).toHaveBeenCalledTimes(2));
  const lane = onSaveLayout.mock.calls[1][1].groups[0];
  expect(lane.id).toBe("lane-0");
  expect(lane.height).toBeGreaterThan(swimlaneFixture().content.groups[0].height);
  // Steps and the text of the diagram are untouched.
  expect(onSaveLayout.mock.calls[1][1].nodes.map((node: { title: string }) => node.title)).toEqual(swimlaneFixture().content.nodes.map(node => node.title));
});

test("resize handles are inert when the report cannot save its layout", () => {
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} />);
  expect((screen.getByRole("button", { name: "Resize node Click checkout from bottom-right" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Resize lane User from bottom-right" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a diagram that colors steps or dashes links always shows a legend, even when its author wrote none", () => {
  const plain = swimlaneFixture();
  delete plain.content.legend;
  const { unmount } = render(<ReportSwimlanes diagrams={[plain]} files={[]} />);
  const legend = screen.getByRole("group", { name: "Design legend" });
  expect(within(legend).getByText("Legend")).toBeTruthy();
  expect(within(legend).getAllByText("No meaning saved").length).toBeGreaterThan(0);
  unmount();
  const none = swimlaneFixture();
  delete none.content.legend;
  none.content.nodes = none.content.nodes.map(({ color: _color, ...node }) => node);
  none.content.links = none.content.links.map(({ color: _color, style: _style, ...link }) => link);
  render(<ReportSwimlanes diagrams={[none]} files={[]} />);
  expect(screen.queryByRole("group", { name: "Design legend" })).toBeNull();
});


test("a saved diagram's lanes can be flipped between horizontal rows and vertical columns, and the choice is saved", async () => {
  const user = userEvent.setup(), onSaveLayout = vi.fn().mockResolvedValue(undefined);
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} onSaveLayout={onSaveLayout} />);
  const direction = within(screen.getByRole("group", { name: "Lane direction" }));
  expect(direction.getByRole("button", { name: "Horizontal" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(direction.getByRole("button", { name: "Vertical" }));
  await waitFor(() => expect(onSaveLayout).toHaveBeenCalledTimes(1));
  const saved = onSaveLayout.mock.calls[0][1];
  expect(saved.orientation).toBe("vertical");
  // Lanes become columns and each step's position follows; the text and links are untouched.
  expect(saved.groups.every((group: { width: number; height: number }) => group.width === 320 && group.height === 700)).toBe(true);
  expect(saved.nodes[2]).toMatchObject({ id: "step-2", x: swimlaneFixture().content.nodes[2].y, y: swimlaneFixture().content.nodes[2].x });
  expect(saved.links).toEqual(swimlaneFixture().content.links);
  expect(saved.legend.x).toBeGreaterThan(0);
  expect(direction.getByRole("button", { name: "Vertical" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(direction.getByRole("button", { name: "Horizontal" }));
  await waitFor(() => expect(onSaveLayout).toHaveBeenCalledTimes(2));
  expect(onSaveLayout.mock.calls[1][1].orientation).toBe("horizontal");
});

test("the lane direction cannot be changed when the report cannot save its layout", () => {
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} />);
  const direction = within(screen.getByRole("group", { name: "Lane direction" }));
  expect((direction.getByRole("button", { name: "Vertical" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("group", { name: "Lane direction" }).title).toMatch(/Save the report/);
});

test("only the bottom-right resize handle is offered in a report", () => {
  const { container } = render(<ReportSwimlanes diagrams={[swimlaneFixture()]} files={[]} onSaveLayout={vi.fn().mockResolvedValue(undefined)} />);
  expect(container.querySelectorAll(".design-resize.bottom-right").length).toBeGreaterThan(0);
  expect(container.querySelectorAll(".design-group .design-resize.bottom-right")).toHaveLength(5);
});
