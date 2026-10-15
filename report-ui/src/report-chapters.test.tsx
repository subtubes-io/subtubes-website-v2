"use client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { swimlaneFixture } from "../../test/fixtures/report-swimlanes";
import { Review } from "./Review";
import { ReportTabs } from "./ReportTabs";
import { reportFixture } from "./fixtures";
import { chapterButton, openChapter } from "./report-nav-test-utils";
import { reportServices } from "./services";
import type { Decision } from "./model/decisions";
import type { Report } from "./model/types";

beforeEach(() => { localStorage.clear(); vi.spyOn(reportServices, "logAppEvent").mockResolvedValue(); });
afterEach(() => { vi.restoreAllMocks(); });

const withMap = (report: Report): Report => ({ ...report, map: { layers: [{ id: "ui", title: "UI" }], lanes: [{ id: "lane", layer: "ui", title: "App" }], edges: [], nodes: [{ id: "node", title: "Node", desc: "", layer: "ui", lane: "lane", status: "new", file: "src/a.ts", line: 10 }] } });
const open = (report: Report) => render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, notify: vi.fn(), onSave: vi.fn(), onReports: vi.fn(), onAttachDesign: vi.fn(async () => undefined) }} />);
const names = () => within(screen.getByRole("group", { name: "Report chapters" })).getAllByRole("button").map((button) => button.textContent);

test("the menu tells the story in four chapters, with QA right after the Summary, and Blast radius is not one of them", () => {
  open(reportFixture());
  expect(names()).toEqual(["Summary", "QA", "Design", "Changes"]);
  expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Blast radius/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Summary" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("group", { name: "Design views" })).toBeNull();
});

test("the Design chapter is one page of diagrams, with no second menu", () => {
  open({ ...reportFixture(), swimlanes: [swimlaneFixture()] });
  openChapter("Design");
  expect(screen.queryByRole("group", { name: "Design views" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Flow" })).toBeNull();
  expect(screen.getByRole("region", { name: "Report diagrams" })).toBeTruthy();
  expect(chapterButton("Design").getAttribute("aria-pressed")).toBe("true");
});

test("the Summary has no Designs section, with or without attached designs; the Design page holds them", () => {
  open({ ...reportFixture(), swimlanes: [swimlaneFixture()] });
  expect(screen.queryByRole("region", { name: "Designs" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Open design/ })).toBeNull();
  openChapter("Design");
  expect(screen.getByRole("region", { name: "Report diagrams" })).toBeTruthy();
});

test("a report with no attached design shows nothing about designs on the Summary", () => {
  open(reportFixture());
  expect(screen.queryByRole("region", { name: "Designs" })).toBeNull();
  expect(screen.queryByText("No designs are attached to this report yet.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Attach a design" })).toBeNull();
});

test("Design for a report saved without a diagram asks the reviewer to pick one", () => {
  open(reportFixture());
  openChapter("Design");
  expect(screen.getByRole("heading", { name: "No design is attached to this report" })).toBeTruthy();
});

test("no menu button carries a count in parentheses", () => {
  open({ ...reportFixture(), swimlanes: [swimlaneFixture()] });
  const labels = () => screen.getAllByRole("button").filter((button) => button.closest(".report-nav")).map((button) => button.textContent ?? "");
  openChapter("Design");
  expect(labels().some((label) => /\(\d+\)/.test(label))).toBe(false);
  expect(labels()).toEqual(["Summary", "QA", "Design", "Changes"]);
});

test("Changes is its own chapter with the file navigator, approvals and the diff", async () => {
  const user = userEvent.setup();
  open(reportFixture());
  openChapter("Changes");
  const page = within(screen.getByRole("region", { name: "Changes" }));
  expect(page.getByText(/^2 files · \+\d+ \/ −\d+$/)).toBeTruthy();
  expect(page.getByText("0 of 2 files approved")).toBeTruthy();
  expect(page.getByRole("navigation", { name: "Changed files" })).toBeTruthy();
  expect(page.getByRole("switch", { name: "Reviewed and approved" })).toBeTruthy();
  await user.click(page.getByRole("button", { name: /src\/b.ts,/ }));
  expect(page.getByRole("heading", { name: /src\/b.ts/ })).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Node details" })).toBeNull();
});

test("a report with no changed files says so", () => {
  open({ ...reportFixture(), files: [] });
  openChapter("Changes");
  expect(screen.getByText("No files changed in this report.")).toBeTruthy();
});

test("the tabs are inert without a handler", () => {
  render(<ReportTabs config={{ active: "design" as never }} />);
  for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
});
