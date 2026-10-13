"use client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Review } from "./Review";
import { DiffView } from "./DiffView";
import { FileTree, type TreeState } from "./FileTree";
import { splitRows } from "./diffrows";
import { normalizeReport } from "./report-utils";
import { reportFixture } from "./fixtures";
import type { DiffLayout } from "./diffrows";
import { openChapter } from "./report-nav-test-utils";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function openFileReview() {
  fireEvent.click(screen.getByRole("button", { name: "Summary" }));
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
}

test("a report starts on Summary", () => {
  const report = reportFixture();
  render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn() }} />);
  expect(screen.getByRole("button", { name: "Summary" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("region", { name: "Report summary" })).toBeTruthy();
});

describe("React review parity", () => {
  test("Summary escapes content, opens an exact diff by keyboard, and preserves unavailable-file state", async () => {
    const user = userEvent.setup(), notify = vi.fn();
    const { container } = render(<StrictMode><Review config={{ report: reportFixture(), snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify, onSave: vi.fn(), onReports: vi.fn() }} /></StrictMode>);
    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(screen.getByRole("button", { name: "Summary" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Close summary" })).toBeNull();
    expect(screen.getByText("Readable <cards>", { selector: "p" })).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("2 affected files")).toBeTruthy();
    const summary = within(screen.getByRole("region", { name: "Report summary" }));
    await user.click(summary.getByRole("button", { name: "missing.ts" }));
    expect(notify).toHaveBeenCalledWith("No diff is available for missing.ts in this report.");
    expect(screen.getByRole("region", { name: "Report summary" })).toBeTruthy();
    summary.getByRole("button", { name: "src/b.ts" }).focus();
    await user.keyboard("{Enter}");
    // Outside the diagrams a file opens in the Changes chapter, not a drawer.
    expect(screen.getByRole("region", { name: "Changes" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Node details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Changes" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: /src\/b.ts/ })).toBeTruthy();
    expect(container.querySelector(".file-review-tree [aria-current=true]")?.getAttribute("title")).toBe("src/b.ts");
    expect(screen.getByRole("region", { name: "Changes" }).contains(document.activeElement)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Summary" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Report summary" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Summary" }));
  });

  test("split hunks preview exactly 20 aligned rows and retain expansion when changing layout", async () => {
    const user = userEvent.setup(), file = reportFixture().files[0];
    function Fixture() {
      const [layout, setLayout] = useState<DiffLayout>("split");
      return <DiffView config={{ file, flags: [], layout, onLayout: setLayout }} />;
    }
    const { container } = render(<Fixture />);
    expect(container.querySelectorAll(".diff-row:not(.diff-column-head)")).toHaveLength(20);
    expect(container.querySelectorAll(".diff-line-number")[0].textContent).toBe("10");
    expect(screen.getByRole("button", { name: "Side by side" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Expand (5 more rows)" }));
    expect(container.querySelectorAll(".diff-row:not(.diff-column-head)")).toHaveLength(25);
    await user.click(screen.getByRole("button", { name: "Inline" }));
    expect(container.querySelectorAll(".diff-inline > div")).toHaveLength(27);
    await user.click(screen.getByRole("button", { name: "Show fewer lines" }));
    expect(container.querySelectorAll(".diff-inline > div")).toHaveLength(21);
  });

  test("file tree preserves query, collapses, selected focus and immediate filter changes", async () => {
    const user = userEvent.setup(), files = reportFixture().files;
    function Fixture() {
      const [selected, setSelected] = useState(files[0].path);
      const [state, setState] = useState<TreeState>({ query: "", collapsed: new Set() });
      return <FileTree config={{ files, selected, onSelect: setSelected, state, setState }} />;
    }
    const { container } = render(<Fixture />);
    const folder = container.querySelector("details")!;
    await user.click(screen.getByText("src", { selector: "summary" }));
    await waitFor(() => expect(folder.open).toBe(false));
    const search = screen.getByRole("searchbox");
    await user.type(search, "B.TS");
    expect(container.querySelector("details")!.open).toBe(true);
    expect(screen.queryByRole("button", { name: /src\/a.ts/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /src\/b.ts/ }));
    expect((search as HTMLInputElement).value).toBe("B.TS");
    expect(container.querySelector("[aria-current=true]")?.textContent).toContain("b.ts");
    await user.clear(search);
    await waitFor(() => expect(container.querySelector("details")!.open).toBe(false));
    await user.type(search, "nope");
    expect(screen.getByText("No changed files match your search.")).toBeTruthy();
  });

  test("file-only reports use the same drawer without standalone Diff or visual tabs", () => {
    const { container } = render(<Review config={{ report: reportFixture(), snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn() }} />);
    expect(container.querySelector("#side")).toBeNull();
    expect(container.querySelector("#toggle")).toBeNull();
    fireEvent.keyDown(document, { key: "b", ctrlKey: true });
    expect(screen.queryByRole("button", { name: "Diff" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Before \/ after/ })).toBeNull();
    openFileReview();
    expect(screen.getByRole("navigation", { name: "Changed files" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /src\/b.ts,/ }));
    expect(screen.getByRole("heading", { name: /src\/b.ts/ })).toBeTruthy();
    openChapter("Design");
    expect(container.querySelector("#side")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Changed file" })).toBeNull();
    openFileReview();
    expect(container.querySelector(".file-review-tree [aria-current=true]")?.getAttribute("title")).toBe("src/b.ts");
  });
});

test("legacy normalization and hunk helpers do not mutate original reports", () => {
  const input = { narrative: "Legacy", groups: [{ kind: "docs", summary: "Docs", files: ["README.md"] }], files: [] };
  const before = JSON.stringify(input);
  const result = normalizeReport(input);
  expect(typeof result).not.toBe("string");
  if (typeof result !== "string") expect(result.files[0].path).toBe("README.md");
  expect(JSON.stringify(input)).toBe(before);
  const rows = splitRows({ oldStart: 1, newStart: 1, changedLines: [], lines: ["-one", "-two", "+three", "\\ No newline", " context"] });
  expect(rows[0].old?.line).toBe(1);
  expect(rows[1].next).toBeUndefined();
  expect(rows[2].next?.line).toBe(0);
  expect(rows[3].next?.line).toBe(2);
});

test("file approval errors stay attached to the requested file after changing files", async () => {
  const user = userEvent.setup(), report = reportFixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  let reject!: (reason: Error) => void;
  const approve = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn(), onApproveFile: approve }} />);
  openFileReview();
  await user.click(screen.getByRole("switch", { name: "Reviewed and approved" }));
  await user.click(screen.getByRole("navigation", { name: "Changed files" }).querySelector("button[title='src/b.ts']")!);
  reject(new Error("File A failed"));
  await waitFor(() => expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("navigation", { name: "Changed files" }).querySelector("button[title='src/a.ts']")!);
  expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
});

test("approval failure keeps confirmed state, permits retry, and unsaved reports cannot approve", async () => {
  const user = userEvent.setup(), report = reportFixture(), notify = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const approve = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
  const config = { report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify, onSave: vi.fn(), onReports: vi.fn(), onApproveFile: approve };
  const { rerender } = render(<Review config={config} />);
  openFileReview();
  const checkbox = screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement;
  await user.click(checkbox);
  expect((await screen.findByRole("alert")).textContent).toContain("Disk full");
  expect(checkbox.checked).toBe(false);
  expect(checkbox.disabled).toBe(false);
  await user.click(checkbox);
  await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
  rerender(<Review key="unsaved" config={{ ...config, snapshot: { ...config.snapshot, id: "" } }} />);
  openFileReview();
  expect((screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Save this report to a project first")).toBeTruthy();
});

test("normalization retains approval for renamed and deleted files", () => {
  const report = reportFixture();
  report.files[0] = { ...report.files[0], oldPath: "src/old.ts", status: "renamed", reviewed: true };
  report.files[1] = { ...report.files[1], status: "deleted", reviewed: false };
  const normalized = normalizeReport({ report });
  expect(typeof normalized).not.toBe("string");
  if (typeof normalized !== "string") expect(normalized.files).toEqual(report.files);
});

test("saving approval disables duplicate toggles and Summary shows saved file markers", async () => {
  const user = userEvent.setup(), report = reportFixture();
  report.files[1].reviewed = true;
  let finish!: () => void;
  const approve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn(), onApproveFile: approve }} />);
  openFileReview();
  const checkbox = screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement;
  await user.click(checkbox);
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(false);
  expect(screen.getByText("Saving approval...")).toBeTruthy();
  await user.click(checkbox);
  expect(approve).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(checkbox.disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "Summary" }));
  expect(screen.getByText("2 affected files")).toBeTruthy();
  const summary = within(screen.getByRole("region", { name: "Report summary" }));
  expect(summary.getByText("Approved")).toBeTruthy();
});

test("Summary preserves sidebar flags and intent files, and a flag opens its file", async () => {
  const user = userEvent.setup(), report = reportFixture();
  report.flags = [
    { category: "data", severity: "medium", file: "src/a.ts", line: 10, message: "Validate input" },
    { category: "config", severity: "low", file: "src/b.ts", line: 1, message: "Check configuration" },
  ];
  const { container } = render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn() }} />);
  expect(container.querySelector("#toggle")).toBeNull();
  expect(container.querySelector("#side")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Summary" }));
  const summary = within(screen.getByRole("region", { name: "Report summary" }));
  expect(summary.getByRole("heading", { name: "Flags (2)" })).toBeTruthy();
  await user.click(summary.getByRole("button", { name: "src/a.ts:10" }));
  expect(screen.queryByRole("region", { name: "Report summary" })).toBeNull();
  expect(screen.getByRole("heading", { name: /src\/a.ts/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Summary" }));
  within(screen.getByRole("region", { name: "Report summary" })).getByRole("button", { name: "src/b.ts:1" }).focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: /src\/b.ts/ })).toBeTruthy();
});

test("there is no Blast radius or before/after page, and saved screenshots are left untouched", async () => {
  const user = userEvent.setup(), report = reportFixture();
  report.shots = { "home.before.png": "data:image/png;base64,fixture", "home.after.png": "data:image/png;base64,fixture" };
  render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn() }} />);
  expect(screen.queryByRole("button", { name: "Blast radius" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Before \/ after/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Summary" }));
  expect(screen.queryByRole("button", { name: /Visual evidence/ })).toBeNull();
  expect(report.shots["home.before.png"]).toBe("data:image/png;base64,fixture");
});

test("file filtering captures a collapse before the asynchronous toggle event", async () => {
  const files = reportFixture().files;
  function Fixture() {
    const [state, setState] = useState<TreeState>({ query: "", collapsed: new Set() });
    return <FileTree config={{ files, selected: files[0].path, onSelect: vi.fn(), state, setState }} />;
  }
  const { container } = render(<Fixture />);
  container.querySelector("details")!.open = false;
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "b.ts" } });
  expect(container.querySelector("details")!.open).toBe(true);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  await waitFor(() => expect(container.querySelector("details")!.open).toBe(false));
});
