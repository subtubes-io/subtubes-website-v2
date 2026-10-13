"use client";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { QaStep, QaWalkthrough } from "./model/qa";
import { WalkthroughView } from "./QaPage";
import { reportServices } from "./services";

afterEach(() => vi.restoreAllMocks());

const step = (id: string, note: string, extra: Partial<QaStep> = {}): QaStep => ({ id, revision: 1, note, recordedBy: "user", createdAt: "2026-10-12T17:00:00.000Z", updatedAt: "2026-10-12T17:00:00.000Z", ...extra });
const walkthrough: QaWalkthrough = { id: "w", revision: 1, title: "Checkout", createdAt: "2026-10-12T17:00:00.000Z", updatedAt: "2026-10-12T17:00:00.000Z",
  steps: [step("a", "Open the **cart**"), step("b", "Pay"), step("c", "Done")] };

test("selecting a thumbnail opens the walkthrough as a carousel at that step, and the arrows and keys move along it", async () => {
  const user = userEvent.setup();
  vi.spyOn(reportServices, "attachmentBytes").mockResolvedValue(new Uint8Array([0x89, 0x50]).buffer);
  render(<WalkthroughView walkthrough={walkthrough} />);
  await user.click(screen.getByRole("button", { name: "Open step 2 of Checkout" }));
  const dialog = screen.getByRole("dialog", { name: "Walkthrough: Checkout" });
  expect(dialog.querySelector("[role=status]")?.textContent).toBe("Step 2 of 3");
  expect(dialog.textContent).toContain("Pay");
  await user.click(screen.getByRole("button", { name: "Next step" }));
  expect(dialog.querySelector("[role=status]")?.textContent).toBe("Step 3 of 3");
  expect((screen.getByRole("button", { name: "Next step" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(dialog.querySelector("[role=status]")?.textContent).toBe("Step 1 of 3");
  expect(dialog.querySelector(".carousel-note strong")?.textContent).toBe("cart");
  await user.click(screen.getByRole("button", { name: "Close walkthrough" }));
  expect(screen.queryByRole("dialog", { name: /Walkthrough:/ })).toBeNull();
});
