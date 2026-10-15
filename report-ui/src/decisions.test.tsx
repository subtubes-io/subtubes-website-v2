"use client";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { DiffView } from "./DiffView";
import { DecisionCard, DecisionComposer, NodeDecisions, type DecisionControls } from "./Decisions";
import { SummaryPage } from "./SummaryPage";
import { ReportSwimlanes } from "./ReportSwimlanes";
import { ReportTabs } from "./ReportTabs";
import { useDecisions } from "./useDecisions";
import { captureAnchor } from "./model/anchors";
import type { Decision, DecisionResult } from "./model/decisions";
import { reportFixture } from "./fixtures";
import { normalizeReport } from "./report-utils";
import { reportServices } from "./services";
import { chooseDiffAction, rightClickLine } from "./diff-actions-test-utils";
import { swimlaneFixture } from "../../test/fixtures/report-swimlanes";

afterEach(() => { vi.restoreAllMocks(); });
const file = reportFixture().files[0];
const made = (patch: Partial<Decision> = {}): Decision => ({
  id: "d1", revision: 1, title: "Keep the legacy default", kind: "tradeoff", decision: "Keep the **legacy** default for callers.", rationale: "Other teams depend on it.",
  alternatives: [{ option: "Switch to the new default", whyNot: "Breaks callers" }], revisitWhen: "Callers migrate",
  madeBy: "human", recordedBy: "agent", agent: "Test agent", source: { kind: "chat", quote: "keep the old default" },
  confirmed: false, status: "active", anchors: [{ type: "line", anchor: captureAnchor(file, "new", 10, "new") }],
  createdAt: "2026-10-11T20:00:00.000Z", updatedAt: "2026-10-11T20:00:00.000Z", ...patch,
});
const guess = (patch: Partial<Decision> = {}) => made({ id: "d2", title: "Assumed UTC", madeBy: "agent", source: { kind: "other" }, anchors: [{ type: "file", file: "src/b.ts" }], ...patch });
const controls = (decisions: Decision[] = []): DecisionControls => ({
  decisions, enabled: true, busy: false, error: "",
  onCreate: vi.fn().mockResolvedValue(undefined), onEdit: vi.fn().mockResolvedValue(undefined), onConfirm: vi.fn().mockResolvedValue(undefined),
  onStatus: vi.fn().mockResolvedValue(undefined), onRemove: vi.fn().mockResolvedValue(undefined),
  describeAnchor: (anchor) => anchor.type === "line" ? `${anchor.anchor.path}:${anchor.anchor.line}` : anchor.type === "file" ? anchor.file : `${anchor.diagramId}/${anchor.nodeId}`,
  onOpenAnchor: vi.fn(),
});
const result = (decisions: Decision[]): DecisionResult => ({ projectId: "p", reportId: "r", base: "HEAD", head: "WORKING", decisions });

test.each(["split", "inline"] as const)("%s diffs record a decision on the exact side, line and saved text", async (layout) => {
  const user = userEvent.setup(), decisions = controls();
  const { container } = render(<DiffView config={{ file, flags: [], layout, onLayout: vi.fn(), decisions }} />);
  rightClickLine(container, "new", 10); await chooseDiffAction(user, "decision");
  const form = screen.getByRole("form", { name: "Decision on After line 10" });
  expect(within(form).getAllByRole("textbox")).toHaveLength(2);
  await user.type(within(form).getByLabelText("Why"), "Ship without a test: deadline.");
  fireEvent.change(within(form).getByLabelText("Alternatives"), { target: { value: "Write the test — too slow\nDelay the release" } });
  await user.click(within(form).getByRole("button", { name: "Record decision" }));
  await waitFor(() => expect(decisions.onCreate).toHaveBeenCalledWith({
    title: "Ship without a test: deadline.", kind: "tradeoff", decision: "Ship without a test: deadline.", rationale: "",
    alternatives: [{ option: "Write the test", whyNot: "too slow" }, { option: "Delay the release", whyNot: "" }],
    anchors: [{ type: "line", file: "src/a.ts", side: "new", line: 10, expectedText: "new" }],
  }));
});

test("lines with decisions show their card inline, superseded ones are hidden, and lines carry no buttons", () => {
  const items = [made(), made({ id: "d3", title: "Old call", status: "superseded" })];
  const { container } = render(<DiffView config={{ file, flags: [], layout: "split", onLayout: vi.fn(), decisions: controls(items) }} />);
  expect(screen.getByRole("article", { name: "Decision: Keep the legacy default" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "Decision: Old call" })).toBeNull();
  expect(container.querySelector(".decision-card strong")?.textContent).toBe("legacy");
  expect(screen.queryAllByRole("button", { name: /on (Before|After) line/ })).toHaveLength(0);
});

test("a card shows the decision and why without badges, source notes or reviewer actions beyond Delete", () => {
  const c = controls();
  render(<DecisionCard item={made()} controls={c} />);
  expect(screen.getByText(/“keep the old default”/)).toBeTruthy();
  expect(screen.getByText("Callers migrate")).toBeTruthy();
  for (const text of ["Human decision", "Agent assumption", "Needs confirmation", /Recorded by/]) expect(screen.queryByText(text)).toBeNull();
  for (const name of ["Confirm", "Confirm assumption", "Adopt as my decision", "Edit", "Mark superseded"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
});

test("deleting a decision asks first, and double-clicking edits its text in place", async () => {
  const user = userEvent.setup(), c = controls();
  const ask = vi.spyOn(reportServices, "ask").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const item = made();
  render(<DecisionCard item={item} controls={c} />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(c.onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(c.onRemove).toHaveBeenCalledWith(item));
  await user.dblClick(screen.getByText("Other teams depend on it."));
  const why = screen.getByRole("textbox", { name: "Why (Markdown)" });
  await user.clear(why); await user.type(why, "Callers still rely on it.");
  await user.tab();
  // A hand-written title is kept; only the edited field is sent.
  await waitFor(() => expect(c.onEdit).toHaveBeenCalledWith(item, { rationale: "Callers still rely on it." }));
});

test("alternatives and revisit-when are edited in place, one alternative per line, and can be added or cleared", async () => {
  const user = userEvent.setup(), c = controls();
  const item = made();
  const { rerender } = render(<DecisionCard item={item} controls={c} />);
  await user.dblClick(screen.getByText(/Breaks callers/));
  const alternatives = screen.getByRole("textbox", { name: "Alternatives (Markdown)" });
  expect(alternatives).toHaveProperty("value", "Switch to the new default — Breaks callers");
  await user.clear(alternatives); await user.type(alternatives, "Keep it — too slow{Enter}Delay the release");
  await user.tab();
  await waitFor(() => expect(c.onEdit).toHaveBeenCalledWith(item, { alternatives: [{ option: "Keep it", whyNot: "too slow" }, { option: "Delay the release", whyNot: "" }] }));
  await user.dblClick(screen.getByText("Callers migrate"));
  const revisit = screen.getByRole("textbox", { name: "Revisit when (Markdown)" });
  await user.clear(revisit); await user.type(revisit, "Traffic doubles");
  await user.tab();
  await waitFor(() => expect(c.onEdit).toHaveBeenCalledWith(item, { revisitWhen: "Traffic doubles" }));
  // Cleared values show a prompt to add them again; a read-only card shows neither.
  const bare = made({ alternatives: [], revisitWhen: undefined });
  rerender(<DecisionCard item={bare} controls={c} />);
  expect(screen.getByText(/None recorded\. Double-click to add\./)).toBeTruthy();
  expect(screen.getByText(/Not set\. Double-click to add\./)).toBeTruthy();
  rerender(<DecisionCard item={bare} controls={{ ...c, enabled: false }} />);
  expect(screen.queryByText("Alternatives")).toBeNull();
  expect(screen.queryByText("Revisit when")).toBeNull();
});

test("editing a plain decision's text re-derives its title", async () => {
  const user = userEvent.setup(), c = controls();
  const plain = made({ title: "Keep it", decision: "Keep it", rationale: "", alternatives: [], kind: "direction" });
  render(<DecisionCard item={plain} controls={c} />);
  await user.dblClick(screen.getByText("Keep it", { selector: "p" }));
  const field = screen.getByRole("textbox", { name: "Decision (Markdown)" });
  await user.clear(field); await user.type(field, "Ship it");
  await user.tab();
  await waitFor(() => expect(c.onEdit).toHaveBeenCalledWith(plain, { decision: "Ship it", title: "Ship it" }));
});

test("a failed save keeps the draft and shows the error", async () => {
  const user = userEvent.setup(), onSave = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined), onCancel = vi.fn();
  render(<DecisionComposer label="Record a decision" anchors={[]} busy={false} onSave={onSave} onCancel={onCancel} />);
  await user.type(screen.getByLabelText("Why"), "D");
  await user.click(screen.getByRole("button", { name: "Record decision" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Error: Disk full");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Why").value).toBe("D");
  expect(onCancel).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Record decision" }));
  await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
});

test("report diagram steps show a decision marker and list their decisions in the drawer", async () => {
  const user = userEvent.setup(), c = controls([made({ anchors: [{ type: "node", diagramId: "horizontal", nodeId: "step-2" }] })]);
  render(<ReportSwimlanes diagrams={[swimlaneFixture()]} decisions={c} />);
  const header = screen.getByText("Validate order", { selector: "strong" });
  expect(within(header).getByRole("img", { name: "1 decision" })).toBeTruthy();
  expect(within(screen.getByText("Save order", { selector: "strong" }).parentElement!).queryByRole("img", { name: /decision/ })).toBeNull();
  await user.dblClick(header);
  const drawer = screen.getByRole("dialog", { name: "Node details: Validate order" });
  const section = within(drawer).getByRole("region", { name: "Decisions on this step" });
  expect(within(section).getByRole("article", { name: "Decision: Keep the legacy default" })).toBeTruthy();
  await user.click(within(section).getByRole("button", { name: "Record a decision" }));
  const form = within(section).getByRole("form", { name: "Decision on this step" });
  await user.type(within(form).getByLabelText("Why"), "Validate first.");
  await user.click(within(form).getByRole("button", { name: "Record decision" }));
  await waitFor(() => expect(c.onCreate).toHaveBeenCalledWith(expect.objectContaining({ anchors: [{ type: "node", diagramId: "horizontal", nodeId: "step-2" }] })));
});

test("a node with no decisions says so", () => {
  render(<NodeDecisions diagramId="d" nodeId="n" controls={controls()} />);
  expect(screen.getByText("No judgement calls are recorded for this step.")).toBeTruthy();
});

test("useDecisions mutates through the native bridge and refreshes agent records", async () => {
  vi.spyOn(reportServices, "logAppEvent").mockResolvedValue();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const first = made(), agentAdded = [first, guess()];
  const call = vi.spyOn(reportServices, "decisions");
  call.mockImplementation(async () => result([first]));
  const { result: hook, unmount } = renderHook(() => useDecisions({ projectId: "p", reportId: "r" }, [], vi.fn()));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: "list", projectId: "p", reportId: "r" }));
  await act(async () => { await hook.current.mutate({ action: "confirm", decisionId: "d1", confirmed: true }); });
  expect(call).toHaveBeenCalledWith({ action: "confirm", decisionId: "d1", confirmed: true, projectId: "p", reportId: "r" });
  call.mockImplementation(async () => result(agentAdded));
  await act(async () => { await hook.current.refresh(); });
  expect(hook.current.decisions).toHaveLength(2);
  call.mockRejectedValue(new Error("stale"));
  await act(async () => { await expect(hook.current.mutate({ action: "remove", decisionId: "d1" })).rejects.toThrow("stale"); });
  expect(hook.current.error).toContain("Could not update decisions");
  unmount();
});

test("useDecisions lets edits overlap instead of refusing one that arrives while another is saving", async () => {
  vi.spyOn(reportServices, "logAppEvent").mockResolvedValue();
  const release: (() => void)[] = [];
  const call = vi.spyOn(reportServices, "decisions").mockImplementation(async (request) => request.action === "edit"
    ? new Promise<DecisionResult>((resolve) => release.push(() => resolve(result([made()])))) : result([made()]));
  const { result: hook, unmount } = renderHook(() => useDecisions({ projectId: "p", reportId: "r" }, [], vi.fn()));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: "list", projectId: "p", reportId: "r" }));
  let first!: Promise<unknown>, second!: Promise<unknown>;
  act(() => { first = hook.current.mutate({ action: "edit", decisionId: "d1", decision: "One" }); second = hook.current.mutate({ action: "edit", decisionId: "d1", decision: "Two" }); });
  await waitFor(() => expect(release).toHaveLength(2));
  expect(hook.current.busy).toBe(true);
  await act(async () => { release.forEach((done) => done()); await Promise.all([first, second]); });
  expect(hook.current.busy).toBe(false);
  expect(hook.current.error).toBe("");
  unmount();
});

test("useDecisions requires a saved report", async () => {
  const { result: hook } = renderHook(() => useDecisions(undefined, [], vi.fn()));
  expect(hook.current.enabled).toBe(false);
  await act(async () => { await expect(hook.current.mutate({ action: "remove", decisionId: "d" })).rejects.toThrow("Save the report"); });
});

test("reports keep valid decisions and reject corrupted or unquoted ones", () => {
  const base = JSON.parse(JSON.stringify(reportFixture()));
  const kept = normalizeReport({ ...base, decisions: [made()] });
  expect(typeof kept !== "string" && kept.decisions?.[0].id).toBe("d1");
  const plain = normalizeReport(base);
  expect(typeof plain !== "string" && plain.decisions).toBeUndefined();
  expect(normalizeReport({ ...base, decisions: [{ id: "bad" }] })).toBe("This report has invalid decisions.");
  expect(normalizeReport({ ...base, decisions: [made({ source: { kind: "chat" } })] })).toBe("This report has invalid decisions.");
});

test("there is no Decisions tab: judgement calls live on the Summary", () => {
  render(<ReportTabs config={{ active: "summary", onSelect: vi.fn() }} />);
  expect(screen.queryByRole("button", { name: "Decisions" })).toBeNull();
});
