"use client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StrictMode } from "react";
import { VisualReview, visualScenarios } from "./VisualReview";
import { reportFixture } from "./fixtures";
import { normalizeReport } from "./report-utils";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
function fixture() {
  const report = reportFixture();
  report.visual = { version: 1, source: "playwright-json", importedAt: "2026-10-04", warnings: ["Trace not imported"], scenarios: [
    { id: "dashboard", title: "Dashboard", file: "visual.spec.ts", project: "chromium", status: "failed", comparison: "snapshot-baseline",
      before: png, after: png, diff: png, attempts: [{ status: "failed", retry: 0, durationMs: 123, errors: ["Expected <pixels> to match"] }], notes: [] },
    { id: "settings", title: "Settings", file: "settings.spec.ts", project: "webkit", status: "skipped", comparison: "capture", attempts: [], notes: ["No screenshot attached"] },
  ] };
  return report;
}
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});
afterEach(() => vi.restoreAllMocks());

test("gallery shows test status, baseline provenance, missing captures, and filters", () => {
  render(<VisualReview report={fixture()} />);
  expect(screen.getByText("Snapshot baseline comparison — not Git before/after", { exact: false })).toBeTruthy();
  expect(screen.getByText("failed", { selector: "span" })).toBeTruthy();
  expect(screen.getByText("No test results")).toBeTruthy();
  fireEvent.click(screen.getByText("After test attempts (1)"));
  expect(screen.getByText("Expected <pixels> to match")).toBeTruthy();
  fireEvent.click(screen.getByRole("combobox", { name: "Visual test status" }));
  fireEvent.click(screen.getByRole("option", { name: "Failed" }));
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-match" } });
  expect(screen.getByText("No visual scenarios match these filters.")).toBeTruthy();
});

test("inspection supports slider, zoom, Playwright diff, synchronized scrolling and close", () => {
  const { container } = render(<StrictMode><VisualReview report={fixture()} /></StrictMode>);
  fireEvent.click(screen.getAllByRole("button", { name: "Inspect images" })[0]);
  const dialog = screen.getByRole("dialog"), viewer = within(dialog);
  const slider = viewer.getByRole("button", { name: "Comparison slider" }) as HTMLButtonElement;
  expect(slider.disabled).toBe(true);
  for (const img of viewer.getAllByRole("img")) {
    Object.defineProperty(img, "naturalWidth", { value: 1280, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 800, configurable: true });
    fireEvent.load(img);
  }
  expect(slider.disabled).toBe(false);
  const scrolls = dialog.querySelectorAll<HTMLElement>(".visual-scroll");
  scrolls[0].scrollTop = 30; scrolls[0].scrollLeft = 12;
  fireEvent.scroll(scrolls[0]);
  expect(scrolls[1].scrollTop).toBe(30); expect(scrolls[1].scrollLeft).toBe(12);
  fireEvent.click(slider);
  fireEvent.change(viewer.getByRole("slider"), { target: { value: "70" } });
  expect(container.querySelector<HTMLElement>(".visual-overlay-after")!.style.clipPath).toBe("inset(0 0 0 70%)");
  fireEvent.click(viewer.getByRole("combobox", { name: "Image zoom" }));
  fireEvent.click(viewer.getByRole("option", { name: "200%" }));
  expect(container.querySelector<HTMLElement>(".visual-slider-surface")!.style.width).toBe("200%");
  expect(container.querySelector(".visual-slider-scroll")!.contains(viewer.getByRole("slider"))).toBe(true);
  for (const value of [0, 25, 50, 75, 100]) {
    fireEvent.change(viewer.getByRole("slider"), { target: { value: String(value) } });
    expect(container.querySelector<HTMLElement>(".visual-divider-line")!.style.left).toBe(`${value}%`);
    expect(container.querySelector<HTMLElement>(".visual-overlay-after")!.style.clipPath).toBe(`inset(0 0 0 ${value}%)`);
  }
  fireEvent.click(viewer.getByRole("button", { name: "Playwright diff" }));
  expect(viewer.getByRole("img", { name: "Dashboard playwright diff" })).toBeTruthy();
  fireEvent.click(viewer.getByRole("button", { name: "Close images" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Inspect images" })[0]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("image errors are explicit and mismatched dimensions do not enable slider", () => {
  render(<VisualReview report={fixture()} />);
  fireEvent.error(screen.getByRole("img", { name: "Dashboard actual" }));
  expect(screen.getByRole("alert").textContent).toContain("Could not display");
  fireEvent.click(screen.getAllByRole("button", { name: "Inspect images" })[0]);
  const viewer = within(screen.getByRole("dialog"));
  viewer.getAllByRole("img").forEach((img, index) => {
    Object.defineProperty(img, "naturalWidth", { value: 100 + index });
    Object.defineProperty(img, "naturalHeight", { value: 100 });
    fireEvent.load(img);
  });
  expect((viewer.getByRole("button", { name: "Comparison slider" }) as HTMLButtonElement).disabled).toBe(true);
});

test("legacy dotted screenshot names remain paired and imports retain visual evidence", () => {
  const report = reportFixture();
  report.shots = { "dashboard.dark.before.png": png, "dashboard.dark.after.png": png, "mobile.after.png": png };
  expect(visualScenarios(report).map((scenario) => scenario.title)).toEqual(["dashboard.dark", "mobile"]);
  render(<VisualReview report={report} />);
  expect(screen.getByRole("img", { name: "dashboard.dark before" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "dashboard.dark after" })).toBeTruthy();
  expect(screen.getByText("No before image attached.")).toBeTruthy();
  const original = fixture(), normalized = normalizeReport(original);
  expect(typeof normalized).not.toBe("string");
  if (typeof normalized !== "string") expect(normalized.visual).toEqual(original.visual);
});
