import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { assertAttachmentReferences, DocumentError } from "../lib/cloud-push/document-compatibility";
import { MAX_IMAGE_BYTES, readImageBody, readImageStream, validateImage } from "../lib/cloud-push/images";

const hash = "a".repeat(64);
const errorCode = (code: string) => (error: unknown) => error instanceof DocumentError && error.code === code;

test("all report image reference forms must be in the manifest", () => {
  for (const document of [
    { walkthroughs: [{ steps: [{ image: hash }] }] },
    { swimlanes: [{ preview: hash, content: { nodes: [{ comment: `![shot](attachment:${hash})` }] } }] },
    { shots: { "page.png": hash } },
    { description: `![shot](attachment:${hash})` },
  ]) {
    assert.throws(() => assertAttachmentReferences(document, []), errorCode("invalid_document"));
    assert.doesNotThrow(() => assertAttachmentReferences(document, [hash]));
  }
  for (const image of [null, "", "wrong", 123]) {
    assert.throws(() => assertAttachmentReferences({ walkthroughs: [{ steps: [{ image }] }] }, []), errorCode("invalid_document"));
  }
  assert.doesNotThrow(() => assertAttachmentReferences({ preview: "ordinary library display metadata" }, []));
});

test("bounded image streams accept exactly 2 MiB and cancel at one byte over", async () => {
  assert.equal((await readImageStream(new Blob([new Uint8Array(MAX_IMAGE_BYTES)]).stream())).length, MAX_IMAGE_BYTES);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readImageStream(stream), errorCode("too_large"));
  assert.equal(cancelled, true);
  const request = new Request("http://localhost/image", { method: "POST", headers: { "content-length": String(MAX_IMAGE_BYTES + 1) }, body: "small" });
  await assert.rejects(readImageBody(request), errorCode("too_large"));
  const misleading = new Request("http://localhost/image", { method: "POST", headers: { "content-length": "1" }, body: new Uint8Array(MAX_IMAGE_BYTES + 1) });
  await assert.rejects(readImageBody(misleading), errorCode("too_large"));
});

test("image inspection verifies supported types, actual MIME, nonempty bytes and dimension boundaries without rewriting", async () => {
  for (const format of ["png", "jpeg", "webp", "gif"] as const) {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#38bdf8" } }).toFormat(format).toBuffer();
    const original = Buffer.from(bytes);
    assert.deepEqual(await validateImage(bytes, `image/${format}`), { width: 20, height: 10 });
    assert.deepEqual(bytes, original);
    await assert.rejects(validateImage(bytes, format === "png" ? "image/jpeg" : "image/png"), errorCode("invalid_document"));
  }
  await assert.rejects(validateImage(Buffer.alloc(0), "image/png"), errorCode("invalid_document"));
  await assert.rejects(validateImage(Buffer.from("not an image"), "image/png"), errorCode("invalid_document"));
  await assert.rejects(validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"), errorCode("too_large"));
  const boundary = await sharp({ create: { width: 16384, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await validateImage(boundary, "image/png")).width, 16384);
  const over = await sharp({ create: { width: 16385, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(validateImage(over, "image/png"), errorCode("invalid_document"));
});
