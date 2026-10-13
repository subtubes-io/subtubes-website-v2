"use client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { DiffView } from "./DiffView";
import type { DecisionControls } from "./Decisions";
import { reportFixture } from "./fixtures";
import { diffCode, diffMenu, rightClickLine, rightClickSelection } from "./diff-actions-test-utils";

afterEach(() => { window.getSelection()?.removeAllRanges(); });
const file = reportFixture().files[0];
const decisions = (patch: Partial<DecisionControls> = {}): DecisionControls => ({
  decisions: [], enabled: true, busy: false, error: "", onCreate: vi.fn().mockResolvedValue(undefined), onEdit: vi.fn().mockResolvedValue(undefined),
  onConfirm: vi.fn().mockResolvedValue(undefined), onStatus: vi.fn().mockResolvedValue(undefined), onRemove: vi.fn().mockResolvedValue(undefined),
  describeAnchor: () => "", onOpenAnchor: vi.fn(), ...patch,
});
const view = (config: Record<string, unknown>) => render(<DiffView config={{ file, flags: [], layout: "split", onLayout: vi.fn(), ...config }} />);

test("the diff explains the gesture and has no per-line buttons", () => {
  const { container } = view({ decisions: decisions() });
  expect(screen.getByText(/right-click/)).toBeTruthy();
  expect(container.querySelectorAll(".diff-code button")).toHaveLength(0);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("the menu lists every available action in order and closes on Escape", async () => {
  const user = userEvent.setup();
  const { container } = view({ decisions: decisions() });
  rightClickLine(container, "new", 10);
  expect(within(diffMenu()).getAllByRole("menuitem").map((item) => item.textContent?.replace(/(Record a decision).*/, "$1"))).toEqual(["Record a decision"]);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("items are disabled with a reason until the report is saved", () => {
  const { container } = view({ decisions: decisions({ enabled: false }) });
  rightClickLine(container, "new", 10);
  const item = screen.getByRole("menuitem", { name: /^Record a decision/ }) as HTMLButtonElement;
  expect(item.disabled).toBe(true);
  expect(item.textContent).toContain("Save this report to a project first");
});

test("a click outside dismisses the menu", () => {
  const { container } = view({ decisions: decisions() });
  rightClickLine(container, "new", 10);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("the word the browser selects on right-click is not treated as a highlight", () => {
  const { container } = view({ decisions: decisions() });
  rightClickLine(container, "new", 10);
  expect(diffMenu().textContent).toContain("After line 10");
  expect(diffMenu().textContent).not.toContain("lines");
});

test("a highlighted range targets the whole range", () => {
  const { container } = view({ decisions: decisions() });
  rightClickSelection(diffCode(container, "new", 10), diffCode(container, "new", 12));
  expect(diffMenu().textContent).toContain("After lines 10–12");
});

test("the keyboard opens the menu from a focused line", async () => {
  const user = userEvent.setup();
  const { container } = view({ decisions: decisions() });
  diffCode(container, "new", 10).focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  expect(diffMenu()).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
});
