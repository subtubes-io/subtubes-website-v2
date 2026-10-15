"use client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DesignRefsSchema } from "./model/report-design-refs";
import { normalizeReport } from "./report-utils";
import { reportFixture } from "./fixtures";
import { SummaryPage } from "./SummaryPage";
import { ReportMarkdown, designLink } from "./ReportMarkdown";
import { FileReview } from "./FileReview";

test("report refs strictly validate IDs and preserve additive backward compatibility", () => {
  const ref = { designId: "diagram-1", nodeId: "node_1", label: "Current diagram" };
  const result = normalizeReport({ ...reportFixture(), designRefs: [ref, ref, { designId: "diagram-1" }] });
  expect(typeof result).toBe("object");
  if (typeof result !== "string") expect(result.designRefs).toEqual([ref, { designId: "diagram-1" }]);
  expect((normalizeReport(reportFixture()) as ReturnType<typeof reportFixture>).designRefs).toBeUndefined();
  for (const value of [null, {}, [null], [{ designId: "../diagram" }], [{ designId: "x", nodeId: "" }], [{ designId: "x", label: " " }], [{ designId: "x", snapshot: {} }], Array(51).fill(ref)]) {
    expect(DesignRefsSchema.safeParse(value).success).toBe(false);
    expect(normalizeReport({ ...reportFixture(), designRefs: value })).toBe("This report has invalid design references.");
  }
});

test("summary renders semantic Markdown and navigates exact diagram and node IDs", async () => {
  const report = reportFixture();
  report.narrative = "## Review goals\n\nFirst **paragraph**.\n\nSecond paragraph with `code`.\n\n- One\n- Two\n\n[Current node](design:diagram-1#node_1)";
  report.groups[0].summary = "### Intention heading\n\n1. First step\n2. Second step";
  report.designRefs = [{ designId: "diagram-1", nodeId: "node_1", label: "Live service" }, { designId: "diagram-2" }];
  const onOpenDesign = vi.fn();
  render(<SummaryPage config={{ report, onOpenDesign, onView: vi.fn(), onFile: vi.fn() }} />);
  expect(screen.getByRole("heading", { name: "Review goals" }).tagName).toBe("H2");
  expect(screen.getByRole("heading", { name: "Intention heading" }).tagName).toBe("H3");
  expect(screen.getByText("paragraph").tagName).toBe("STRONG");
  expect(screen.getByText("code").tagName).toBe("CODE");
  expect(screen.getByText("First step").closest("ol")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Current node" }));
  expect(onOpenDesign).toHaveBeenLastCalledWith({ designId: "diagram-1", nodeId: "node_1" });
  expect(screen.queryByRole("region", { name: "Related designs" })).toBeNull();
});

test("Markdown escapes HTML and rejects active protocols without fetching images", () => {
  const { container } = render(<ReportMarkdown config={{ text: [
    "<script>alert('bad')</script>", "<img src=x onerror=alert(1)>",
    "[Unsafe](javascript:alert)", "[Encoded](jav&#x61;script:alert)",
    "[Data](data:text/html,bad)", "![Tracking](https://example.com/track.png)",
    "[Safe](https://example.com/docs)", "[Mail](mailto:demo@example.com)",
    "[Bad ID](design:../diagram)", "[Bad node](design:diagram#../node)",
  ].join("\n\n") }} />);
  expect(container.querySelector("script,img,iframe")).toBeNull();
  expect(container.querySelectorAll("a")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Safe" }).getAttribute("rel")).toBe("noopener noreferrer");
  expect(screen.getByText("Unsafe").closest("a")).toBeNull();
  expect(screen.getByText("Encoded").closest("a")).toBeNull();
  expect(screen.getByText("Bad ID").closest("a")).toBeNull();
  expect(designLink(`design:${"x".repeat(121)}`)).toBeUndefined();
});

test("fenced code highlights common languages and preserves unknown-language text safely", () => {
  const { container } = render(<ReportMarkdown config={{ text: [
    "```js\nconst value = \"safe\";\n```", "```python\ndef value():\n    return 42\n```",
    "```unknown-language\n<img src=x onerror=alert(1)>\n```",
  ].join("\n\n") }} />);
  const blocks = container.querySelectorAll("pre code");
  expect(blocks).toHaveLength(3);
  expect(blocks[0].querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(blocks[1].querySelector(".hljs-keyword")?.textContent).toBe("def");
  expect(blocks[2].textContent).toBe("<img src=x onerror=alert(1)>\n");
  expect(blocks[2].querySelector("[class]")).toBeNull();
  expect(container.querySelector("img,script")).toBeNull();
});

test("file review reuses safe Markdown for intentions and report context", async () => {
  const report = reportFixture(), onOpenDesign = vi.fn();
  report.groups = [{ kind: "feature", files: ["src/a.ts"], summary: "### File intention\n\n**Preserve behavior**.\n\n- Add coverage" }];
  report.narrative = "## Report context heading\n\n[Open diagram](design:diagram)";
  report.designRefs = [{ designId: "diagram", label: "Related live diagram" }];
  render(<FileReview config={{
    report, file: "src/a.ts", onFile: vi.fn(), tree: { query: "", collapsed: new Set() }, setTree: vi.fn(),
    layout: "split", onLayout: vi.fn(), approval: { enabled: false, saving: false, error: "", onChange: vi.fn() },
    onOpenDesign,
  }} />);
  expect(screen.getByRole("heading", { name: "File intention" }).tagName).toBe("H3");
  expect(screen.getByText("Preserve behavior").tagName).toBe("STRONG");
  await userEvent.click(screen.getByText("Report context", { exact: true }));
  expect(screen.getByRole("heading", { name: "Report context heading" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open diagram" }));
  expect(onOpenDesign).toHaveBeenLastCalledWith({ designId: "diagram" });
  await userEvent.click(screen.getByRole("button", { name: "Related live diagram" }));
  expect(onOpenDesign).toHaveBeenLastCalledWith(report.designRefs[0]);
});
