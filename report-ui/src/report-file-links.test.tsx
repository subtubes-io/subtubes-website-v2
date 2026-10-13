"use client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ReportMarkdown, reportFileLink } from "./ReportMarkdown";

test("only known relative paths and unambiguous basenames resolve to saved diffs", () => {
  const files = ["src/a.ts", "src/shared.ts", "test/shared.ts", "src/file with spaces.ts"];
  expect(reportFileLink("file:src%2Fa.ts#L10", files)).toBe("src/a.ts");
  expect(reportFileLink("a.ts:10-12", files)).toBe("src/a.ts");
  expect(reportFileLink("file:src%2Ffile%20with%20spaces.ts", files)).toBe("src/file with spaces.ts");
  expect(reportFileLink("shared.ts", files)).toBeUndefined();
  for (const path of ["file:///etc/passwd", "../src/a.ts", "javascript:alert(1)", "https://example.com/src/a.ts", "file:%zz", "missing.ts"]) {
    expect(reportFileLink(path, files)).toBeUndefined();
  }
});

test("plain mentions, inline code and Markdown links open the same file callback without linking code blocks", async () => {
  const open = vi.fn();
  const { container } = render(<ReportMarkdown config={{
    files: ["src/a.ts", "src/b.ts"], onOpenFile: open,
    text: "See src/a.ts:10-12, `b.ts`, and [the implementation](./src/a.ts#L10).\n\n```ts\nconst path = 'src/a.ts';\n```\n\n[Unsafe](javascript:alert(1)) [Unknown](file:missing.ts)",
  }} />);
  await userEvent.click(screen.getByRole("button", { name: "src/a.ts:10-12" }));
  expect(open).toHaveBeenLastCalledWith("src/a.ts");
  await userEvent.click(screen.getByRole("button", { name: "b.ts" }));
  expect(open).toHaveBeenLastCalledWith("src/b.ts");
  await userEvent.click(screen.getByRole("button", { name: "the implementation" }));
  expect(open).toHaveBeenLastCalledWith("src/a.ts");
  expect(container.querySelector("pre button")).toBeNull();
  expect(container.querySelector("a[href^='javascript:']")).toBeNull();
  expect(screen.queryByRole("button", { name: "Unknown" })).toBeNull();
});
