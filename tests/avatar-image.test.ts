import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareAvatar, MAX_AVATAR_BYTES } from "../lib/avatar-image";

test("avatars are re-encoded and cropped to 256px WebP without metadata", async () => {
  const input = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#38bdf8" } }).withMetadata().png().toBuffer();
  const output = await prepareAvatar(new File([Uint8Array.from(input)], "avatar.png", { type: "image/png" }));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined);
});

test("rejects SVG, oversized, empty, corrupt, and mismatched images", async () => {
  await assert.rejects(prepareAvatar(new File(["<svg/>"], "avatar.svg", { type: "image/svg+xml" })));
  await assert.rejects(prepareAvatar(new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], "large.png", { type: "image/png" })));
  await assert.rejects(prepareAvatar(new File([], "empty.png", { type: "image/png" })));
  await assert.rejects(prepareAvatar(new File(["not an image"], "bad.png", { type: "image/png" })));
  const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#38bdf8" } }).jpeg().toBuffer();
  await assert.rejects(prepareAvatar(new File([Uint8Array.from(input)], "wrong.png", { type: "image/png" })));
});

test("accepts JPEG and WebP and rejects excessive decoded dimensions", async () => {
  const input = sharp({ create: { width: 20, height: 10, channels: 3, background: "#38bdf8" } });
  for (const format of ["jpeg", "webp"] as const) {
    const bytes = await input.clone().toFormat(format).toBuffer();
    const output = await prepareAvatar(new File([Uint8Array.from(bytes)], `avatar.${format}`, { type: `image/${format}` }));
    assert.equal((await sharp(output).metadata()).format, "webp");
  }
  const huge = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: "#38bdf8" } }).png().toBuffer();
  await assert.rejects(prepareAvatar(new File([Uint8Array.from(huge)], "huge.png", { type: "image/png" })));
});
