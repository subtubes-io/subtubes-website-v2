"use client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ReportPage, reportServices } from "./index";
import { reportFixture, snapshotFixture } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

const writeServices = ["decisions", "qa", "reportText", "reportDesigns", "attachments", "designs", "saveSwimlaneLayout", "saveFileApproval"] as const;
const chapter = (name: string) => within(screen.getByRole("group", { name: "Report chapters" })).getByRole("button", { name: new RegExp(`^${name}\\b`) });

test("a report is read only by default, on every chapter, and never calls a write service", async () => {
  const writes = writeServices.map((name) => vi.spyOn(reportServices, name).mockRejectedValue(new Error(`${name} must not be called`)));
  const user = userEvent.setup();
  render(<ReportPage data={reportFixture()} />);

  expect(screen.getByRole("heading", { name: /Review <intent>/ })).toBeTruthy();
  for (const name of ["QA", "Design", "Changes", "Summary"]) await user.click(chapter(name));

  // Nothing offers to change the report: these controls are either absent or disabled.
  for (const label of [/Snapshot report/, /Push to cloud/, /Attach a design/, /Pick a design/, /Record a decision/, /Add step/, /Approve/]) {
    for (const button of screen.queryAllByRole("button", { name: label })) expect((button as HTMLButtonElement).disabled, String(label)).toBe(true);
  }
  expect(screen.queryByText(/Pasted report/)?.closest("[hidden]"), "the unsaved-report banner stays hidden").toBeTruthy();
  writes.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

test("double-clicking text does not start an edit when the report is read only", async () => {
  const user = userEvent.setup();
  render(<ReportPage data={reportFixture()} />);
  await user.dblClick(screen.getByRole("heading", { name: /Review <intent>/ }));
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("data can say where the report is saved, yet stays read only until readOnlyMode is turned off", async () => {
  const save = vi.spyOn(reportServices, "saveFileApproval").mockRejectedValue(new Error("must not be called"));
  const user = userEvent.setup();
  render(<ReportPage data={{ report: reportFixture(), projectId: "p", reportId: "r" }} />);
  await user.click(chapter("Changes"));
  expect((screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement).disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

test("with readOnlyMode off, a saved report edits through the services and shows what was saved", async () => {
  const snap = snapshotFixture();
  const approve = vi.spyOn(reportServices, "saveFileApproval").mockImplementation(async (_project, _report, file, reviewed) => {
    snap.report.files.find((entry) => entry.path === file.path)!.reviewed = reviewed;
    return JSON.stringify(snap);
  });
  const user = userEvent.setup();
  render(<ReportPage data={{ report: reportFixture(), projectId: "p", reportId: "r" }} readOnlyMode={false} />);
  await user.click(chapter("Changes"));
  expect(screen.getByText("0 of 2 files approved")).toBeTruthy();
  await user.click(screen.getByRole("switch", { name: "Reviewed and approved" }));
  await waitFor(() => expect(screen.getByText("1 of 2 files approved")).toBeTruthy());
  expect(approve).toHaveBeenCalledWith("p", "r", expect.objectContaining({ path: "src/a.ts" }), true);
});

test("without a project and report to save to, turning readOnlyMode off still offers no editing", async () => {
  const user = userEvent.setup();
  render(<ReportPage data={reportFixture()} readOnlyMode={false} />);
  await user.click(chapter("Changes"));
  expect((screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement).disabled).toBe(true);
});

test("only one approval saves at a time, and one that finishes after the page is gone changes nothing", async () => {
  const snap = snapshotFixture();
  let finish!: (content: string) => void;
  const approve = vi.spyOn(reportServices, "saveFileApproval").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup();
  const { unmount } = render(<ReportPage data={{ report: reportFixture(), projectId: "p", reportId: "r" }} readOnlyMode={false} />);
  await user.click(chapter("Changes"));
  await user.click(screen.getByRole("switch", { name: "Reviewed and approved" }));
  expect(approve).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("switch", { name: "Reviewed and approved" }) as HTMLInputElement).disabled).toBe(true);
  unmount();
  snap.report.files[0].reviewed = true;
  await act(async () => { finish(JSON.stringify(snap)); });
});
