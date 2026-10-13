"use client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { QaStep, QaWalkthrough } from "./model/qa";
import { QaPage, qaSummary, type QaControls } from "./QaPage";
import { reportServices } from "./services";

afterEach(() => vi.restoreAllMocks());

const step = (id: string, note: string, extra: Partial<QaStep> = {}): QaStep => ({ id, revision: 1, note, recordedBy: "user", createdAt: "2026-10-12T17:00:00.000Z", updatedAt: "2026-10-12T17:00:00.000Z", ...extra });
const walkthrough = (steps: QaStep[], extra: Partial<QaWalkthrough> = {}): QaWalkthrough => ({ id: "w1", revision: 1, title: "Main flow", steps, createdAt: "2026-10-12T17:00:00.000Z", updatedAt: "2026-10-12T17:00:00.000Z", ...extra });
const controls = (steps: QaStep[], extra: Partial<QaControls> = {}): QaControls => ({
  walkthroughs: steps.length || extra.walkthroughs ? [walkthrough(steps)] : [], enabled: true, busy: false, error: "",
  onAddWalkthrough: vi.fn(async () => [walkthrough([])]), onRenameWalkthrough: vi.fn(async () => undefined), onRemoveWalkthrough: vi.fn(async () => undefined),
  onAdd: vi.fn(async () => steps), onEdit: vi.fn(async () => undefined), onMove: vi.fn(async () => undefined), onRemove: vi.fn(async () => undefined), ...extra,
});
const open = (value: QaControls) => render(<QaPage controls={value} onRefresh={vi.fn(async () => undefined)} />);

test("steps are numbered in order, their notes are Markdown, and agent steps say who recorded them", () => {
  open(controls([step("a", "Open the **Orders** page"), step("b", "- header row\n- totals", { recordedBy: "agent", agent: "Playwright agent" })]));
  const first = screen.getByRole("listitem", { name: "QA step 1" }), second = screen.getByRole("listitem", { name: "QA step 2" });
  expect(within(first).getByText("Orders").tagName).toBe("STRONG");
  expect(within(second).getAllByRole("listitem")).toHaveLength(2);
  expect(within(first).getByText(/Added by a reviewer/)).toBeTruthy();
  expect(within(second).getByText(/Recorded by Playwright agent/)).toBeTruthy();
  expect(screen.getByText(/2 steps · 0 with screenshots/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Main flow" })).toBeTruthy();
  expect((within(first).getByRole("button", { name: "Move step 1 earlier" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(second).getByRole("button", { name: "Move step 2 later" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a person edits a note, moves a step and deletes it after confirming", async () => {
  const user = userEvent.setup();
  const value = controls([step("a", "One"), step("b", "Two")]);
  open(value);
  await user.click(screen.getByRole("button", { name: "Edit step 2" }));
  const field = screen.getByLabelText("Note (Markdown)");
  await user.clear(field); await user.type(field, "Two, *revised*");
  await user.click(screen.getByRole("button", { name: "Save step" }));
  expect(value.onEdit).toHaveBeenCalledWith(value.walkthroughs[0], value.walkthroughs[0].steps[1], { note: "Two, *revised*", image: null });

  await user.click(screen.getByRole("button", { name: "Move step 2 earlier" }));
  expect(value.onMove).toHaveBeenCalledWith(value.walkthroughs[0], value.walkthroughs[0].steps[1], 0);

  const ask = vi.spyOn(reportServices, "ask").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await user.click(screen.getByRole("button", { name: "Delete step 1" }));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(value.onRemove).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete step 1" }));
  await waitFor(() => expect(value.onRemove).toHaveBeenCalledWith(value.walkthroughs[0], value.walkthroughs[0].steps[0]));
});

test("each chosen screenshot becomes a step; a step with nothing in it cannot be saved", async () => {
  const user = userEvent.setup();
  const attachments = vi.spyOn(reportServices, "attachments").mockImplementation(async (request) => ({
    attachment: { hash: "a".repeat(64), mime: "image/png", bytes: 3, width: 1, height: 1, filename: "filename" in request ? request.filename : "x", createdAt: "2026-10-12T17:00:00.000Z" },
  }));
  const value = controls([], { walkthroughs: [walkthrough([])] });
  open(value);
  const picker = screen.getByLabelText("Choose screenshots to add as QA steps");
  await user.upload(picker, [new File(["x"], "one.png", { type: "image/png" }), new File(["y"], "two.png", { type: "image/png" }), new File(["z"], "notes.txt", { type: "text/plain" })]);
  await waitFor(() => expect(value.onAdd).toHaveBeenCalledTimes(2));
  expect(attachments).toHaveBeenCalledTimes(2);
  expect(value.onAdd).toHaveBeenCalledWith(value.walkthroughs[0], { image: "a".repeat(64) });
});

test("a report that is not saved to a project is read-only, and the summary line reads well", () => {
  open(controls([step("a", "One")], { enabled: false }));
  expect(screen.getByText("Save this report to a project to record QA.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Add screenshots" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Edit step 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect(qaSummary([step("a", "x", { image: "b".repeat(64) })])).toBe("1 step · 1 with a screenshot");
});

test("a report can hold several walkthroughs: pick one, create another, rename and delete with the usual confirmation", async () => {
  const user = userEvent.setup();
  const a = walkthrough([step("a", "Desktop step")], { id: "w1", title: "Desktop" }), b = walkthrough([step("b", "Mobile step")], { id: "w2", title: "Mobile" });
  const value = controls([], { walkthroughs: [a, b] });
  open(value);
  const tabs = within(screen.getByRole("tablist", { name: "Walkthroughs" }));
  expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Desktop", "Mobile"]);
  expect(screen.getByText("Desktop step")).toBeTruthy();
  await user.click(tabs.getByRole("tab", { name: "Mobile" }));
  expect(screen.getByText("Mobile step")).toBeTruthy();
  expect(screen.queryByText("Desktop step")).toBeNull();

  await user.click(screen.getByRole("button", { name: "New walkthrough" }));
  await user.type(screen.getByLabelText("Walkthrough title"), "Tablet");
  await user.click(screen.getByRole("button", { name: "Create walkthrough" }));
  expect(value.onAddWalkthrough).toHaveBeenCalledWith("Tablet");

  await user.click(tabs.getByRole("tab", { name: "Mobile" }));
  await user.click(screen.getByRole("button", { name: /Rename walkthrough/ }));
  const field = screen.getByLabelText("Walkthrough title");
  await user.clear(field); await user.type(field, "Phone");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  expect(value.onRenameWalkthrough).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" }), "Phone");

  await user.click(screen.getByRole("button", { name: /Delete walkthrough/ }));
  const dialog = screen.getByRole("dialog", { name: "Delete walkthrough?" });
  const confirm = within(dialog).getByRole("button", { name: "Delete walkthrough" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  await user.type(within(dialog).getByRole("textbox"), "Delete me");
  await user.click(confirm);
  await waitFor(() => expect(value.onRemoveWalkthrough).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" }), "Delete me"));
});

test("with no walkthrough yet the page asks for one", () => {
  open(controls([]));
  expect(screen.getByText("Create a walkthrough to start adding steps.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add screenshots" })).toBeNull();
});
