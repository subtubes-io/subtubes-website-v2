"use client";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import { ThemedSelect } from "./ThemedSelect";

function Fixture() {
  const [value, setValue] = useState("all");
  return <ThemedSelect config={{ label: "Status", value, onChange: setValue,
    options: [{ value: "all", label: "All statuses" }, { value: "passed", label: "Passed" }, { value: "failed", label: "Failed" }] }} />;
}

test("themed select supports keyboard selection, typeahead, and Escape without propagating", () => {
  render(<Fixture />);
  const select = screen.getByRole("combobox", { name: "Status" });
  select.focus();
  fireEvent.keyDown(select, { key: "ArrowDown" });
  expect(select.getAttribute("aria-expanded")).toBe("true");
  expect(select.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Passed" }).id);
  fireEvent.keyDown(select, { key: "Enter" });
  expect(select.textContent).toBe("Passed");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyDown(select, { key: "f" });
  fireEvent.keyDown(select, { key: "Enter" });
  expect(select.textContent).toBe("Failed");
  fireEvent.click(select);
  fireEvent.keyDown(select, { key: "Home" });
  fireEvent.keyDown(select, { key: "Escape" });
  expect(select.textContent).toBe("Failed");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(select);
});

test("themed select closes on outside click or blur and preserves its selected option", () => {
  render(<Fixture />);
  const select = screen.getByRole("combobox");
  fireEvent.click(select);
  expect(screen.getByRole("option", { name: "All statuses" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("option", { name: "Failed" }));
  expect(select.textContent).toBe("Failed");
  fireEvent.click(select);
  fireEvent.blur(select, { relatedTarget: document.body });
  expect(screen.queryByRole("listbox")).toBeNull();
});
