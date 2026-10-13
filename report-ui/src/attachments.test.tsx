"use client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ReportMarkdown } from "./ReportMarkdown";
import { MarkdownImageField, embeddedImages, withoutImage } from "./MarkdownImageField";
import { DesignNodeDrawer } from "./DesignNodeDrawer";
import { insertBlock, attachmentHash, imageProblem } from "./attachments";
import { reportServices } from "./services";
import type { Attachment } from "./model/attachments";

const HASH = "ab".repeat(32), OTHER = "cd".repeat(32);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const stored = (hash = HASH): Attachment => ({ hash, mime: "image/png", bytes: 11, width: 3, height: 2, filename: "mock.png", createdAt: "2026-10-12T00:00:00.000Z" });
const image = (name = "login.png", type = "image/png", size = 12) => { const file = new File([new Uint8Array(size)], name, { type }); return file; };
let counter = 0;

beforeEach(() => {
  counter = 0;
  vi.spyOn(reportServices, "attachmentBytes").mockImplementation(async (hash) => { if (hash === "ff".repeat(32)) throw new Error("Unknown attachment."); return PNG.buffer.slice(0) as ArrayBuffer; });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:image-${++counter}`);
});
afterEach(() => { vi.restoreAllMocks(); });

test("only well-formed attachment addresses are recognised", () => {
  expect(attachmentHash(`attachment:${HASH}`)).toBe(HASH);
  for (const bad of [undefined, "attachment:", "attachment:../../x", `attachment:${HASH.toUpperCase()}`, `attachment:${HASH}00`, `file:///${HASH}`, "https://example.com/a.png"]) expect(attachmentHash(bad)).toBeUndefined();
});

test("text is inserted on its own line at the caret", () => {
  expect(insertBlock("", "![a](attachment:x)", 0, 0)).toEqual({ value: "![a](attachment:x)", caret: 18 });
  expect(insertBlock("Hello world", "IMG", 5, 5).value).toBe("Hello\n\nIMG\n\n world");
  expect(insertBlock("Hello", "IMG", 5, 5).value).toBe("Hello\n\nIMG");
  expect(insertBlock("Hello\n", "IMG", 6, 6).value).toBe("Hello\n\nIMG");
  expect(insertBlock("a\n\nb", "IMG", 3, 3).value).toBe("a\n\nIMG\n\nb");
  expect(insertBlock("a\nb", "IMG", 2, 2).value).toBe("a\n\nIMG\n\nb");
  expect(insertBlock("select me", "IMG", 0, 9).value).toBe("IMG");
});

test("images are found once each and can be removed without touching the rest of the text", () => {
  const text = `Intro\n\n![one](attachment:${HASH})\n\nMiddle\n\n![again](attachment:${HASH})\n\n![two](attachment:${OTHER})\n\nEnd`;
  expect(embeddedImages(text)).toEqual([{ hash: HASH, alt: "one" }, { hash: OTHER, alt: "two" }]);
  expect(withoutImage(text, HASH)).toBe(`Intro\n\nMiddle\n\n![two](attachment:${OTHER})\n\nEnd`);
  expect(withoutImage(`![one](attachment:${HASH})`, HASH)).toBe("");
});

test("only PNG, JPEG, WebP and GIF files within the size limit are accepted before sending", () => {
  expect(imageProblem(image("a.png"))).toBeUndefined();
  expect(imageProblem(image("a.svg", "image/svg+xml"))).toMatch(/not a PNG, JPEG, WebP or GIF/);
  expect(imageProblem(image("a.txt", "text/plain"))).toMatch(/not a PNG/);
  expect(imageProblem(image("big.png", "image/png", 5 * 1024 * 1024 + 1))).toMatch(/larger than 5 MB/);
});

test("Markdown shows stored images and still refuses remote ones", async () => {
  render(<ReportMarkdown config={{ text: `Before\n\n![Login mockup](attachment:${HASH})\n\n![tracker](https://evil.example/pixel.png)` }} />);
  expect(await screen.findByRole("img", { name: "Login mockup" })).toHaveProperty("src", "blob:image-1");
  expect(screen.getByRole("button", { name: "Enlarge image: Login mockup" })).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByText("tracker")).toBeTruthy();
  expect(reportServices.attachmentBytes).toHaveBeenCalledTimes(1);
});

test("an image that cannot be read says so instead of leaving a gap", async () => {
  render(<ReportMarkdown config={{ text: `![Gone](attachment:${"ff".repeat(32)})` }} />);
  expect(await screen.findByRole("img", { name: "Image unavailable: Gone" })).toBeTruthy();
});

test("selecting an image opens it at full size and Escape returns focus to it", async () => {
  const user = userEvent.setup();
  render(<ReportMarkdown config={{ text: `![Login mockup](attachment:${OTHER})` }} />);
  const thumb = await screen.findByRole("button", { name: "Enlarge image: Login mockup" });
  await user.click(thumb);
  const viewer = screen.getByRole("dialog", { name: "Image: Login mockup" });
  expect(within(viewer).getByRole("img", { name: "Login mockup" })).toBeTruthy();
  expect(document.activeElement).toBe(within(viewer).getByRole("button", { name: "Close image" }));
  fireEvent(viewer, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Image: Login mockup" })).toBeNull());
  expect(document.activeElement).toBe(thumb);
  await user.click(thumb);
  await user.click(screen.getByRole("button", { name: "Close image" }));
  expect(screen.queryByRole("dialog", { name: "Image: Login mockup" })).toBeNull();
});

function Field({ initial = "", maxLength }: { initial?: string; maxLength?: number }) {
  const [value, setValue] = useState(initial);
  return <><MarkdownImageField label="Description" rows={3} value={value} onChange={setValue} maxLength={maxLength} /><output aria-label="value">{value}</output></>;
}
const pasteImage = (target: HTMLElement, file: File) => fireEvent.paste(target, { clipboardData: { files: [file], items: [{ kind: "file", type: file.type, getAsFile: () => file }] } });

test("pasting an image stores it and inserts its Markdown where the caret is", async () => {
  const add = vi.spyOn(reportServices, "attachments").mockResolvedValue({ attachment: stored() });
  render(<Field initial="Before after" />);
  const box = screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
  box.focus(); box.setSelectionRange(6, 6); fireEvent.select(box);
  pasteImage(box, image("Login screen.png"));
  await waitFor(() => expect(screen.getByLabelText("value").textContent).toBe(`Before\n\n![Login screen](attachment:${HASH})\n\n after`));
  expect(add).toHaveBeenCalledWith({ action: "add", filename: "Login screen.png", data: expect.any(String) });
  expect(await screen.findByRole("list", { name: "Images in description" })).toBeTruthy();
});

test("dropping and choosing images work the same way, and several can be added at once", async () => {
  vi.spyOn(reportServices, "attachments").mockImplementation(async (request) => ({ attachment: stored(request.action === "add" && request.filename === "b.png" ? OTHER : HASH) }));
  const user = userEvent.setup();
  render(<Field />);
  const box = screen.getByRole("textbox", { name: "Description" });
  fireEvent.drop(box, { dataTransfer: { files: [image("a.png")], items: [{ kind: "file", type: "image/png" }] } });
  await waitFor(() => expect(screen.getByLabelText("value").textContent).toContain(`![a](attachment:${HASH})`));
  await user.upload(screen.getByLabelText("Choose images to attach"), [image("b.png")]);
  await waitFor(() => expect(screen.getByLabelText("value").textContent).toContain(`![b](attachment:${OTHER})`));
  expect(screen.getAllByRole("button", { name: /^Remove image/ })).toHaveLength(2);
});

test("a file that is not an allowed image is explained and nothing is stored", async () => {
  const add = vi.spyOn(reportServices, "attachments");
  render(<Field initial="Keep" />);
  pasteImage(screen.getByRole("textbox", { name: "Description" }), image("icon.svg", "image/svg+xml"));
  expect((await screen.findByRole("alert")).textContent).toMatch(/not a PNG, JPEG, WebP or GIF/);
  expect(add).not.toHaveBeenCalled();
  expect(screen.getByLabelText("value").textContent).toBe("Keep");
});

test("a failed upload keeps the text and shows the reason", async () => {
  vi.spyOn(reportServices, "attachments").mockRejectedValue(new Error("Runtime command failed: The image is damaged."));
  render(<Field initial="Keep" />);
  pasteImage(screen.getByRole("textbox", { name: "Description" }), image());
  expect((await screen.findByRole("alert")).textContent).toContain("The image is damaged.");
  expect(screen.getByLabelText("value").textContent).toBe("Keep");
});

test("an image is refused when its Markdown would not fit in the text limit", async () => {
  vi.spyOn(reportServices, "attachments").mockResolvedValue({ attachment: stored() });
  render(<Field initial={"x".repeat(40)} maxLength={50} />);
  pasteImage(screen.getByRole("textbox", { name: "Description" }), image());
  expect((await screen.findByRole("alert")).textContent).toMatch(/no room for another image/);
  expect(screen.getByLabelText("value").textContent).toBe("x".repeat(40));
});

test("the Remove button takes the image out of the text", async () => {
  const user = userEvent.setup();
  render(<Field initial={`Notes\n![mock](attachment:${HASH})`} />);
  await user.click(await screen.findByRole("button", { name: "Remove image: mock" }));
  expect(screen.getByLabelText("value").textContent).toBe("Notes");
  expect(screen.queryByRole("list", { name: "Images in description" })).toBeNull();
});

test("the design node drawer accepts images while editing and shows them in the preview", async () => {
  vi.spyOn(reportServices, "attachments").mockResolvedValue({ attachment: stored() });
  const onEdit = vi.fn(), onStart = vi.fn(), onEnd = vi.fn();
  const text = (value: string) => <ReportMarkdown config={{ text: value }} />;
  const node = { id: "n", title: "Login", comment: "Spec" };
  const { rerender } = render(<DesignNodeDrawer config={{ node, onEdit, onStart, onEnd, onClose: vi.fn(), render: text }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Description (Markdown)" }) as HTMLTextAreaElement;
  box.setSelectionRange(4, 4); fireEvent.select(box);
  pasteImage(box, image("flow.png"));
  await waitFor(() => expect(onEdit).toHaveBeenCalledWith("comment", `Spec\n\n![flow](attachment:${HASH})`));
  expect(onStart).toHaveBeenCalled();
  rerender(<DesignNodeDrawer config={{ node: { ...node, comment: `Spec\n\n![flow](attachment:${HASH})` }, onEdit, onStart, onEnd, onClose: vi.fn(), render: text }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByRole("img", { name: "flow" })).toBeTruthy();
});

test("a read-only drawer offers no way to add images", () => {
  render(<DesignNodeDrawer config={{ node: { id: "n", title: "T", comment: "C" }, readOnly: true, onEdit: vi.fn(), onStart: vi.fn(), onEnd: vi.fn(), onClose: vi.fn(), render: (t) => <p>{t}</p> }} />);
  expect(screen.queryByRole("button", { name: /Add image/ })).toBeNull();
});
