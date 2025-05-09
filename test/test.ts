import { it, describe } from "node:test";
import assert from "node:assert";
import { grgb2rgb } from "../src/utils";
import sharp from "sharp";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createSession, Detection, predict } from "../src/object-detection";
import { createCanvas, loadImage } from "@napi-rs/canvas";

async function drawDetection(
  inputBuffer: Buffer,
  detections: Detection[],
  width: number,
  height: number
) {
  const image = await loadImage(inputBuffer);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  ctx.strokeStyle = "red";
  ctx.lineWidth = 3;
  ctx.font = "16px Arial";
  ctx.fillStyle = "red";
  detections.forEach(({ xyxy, coco, label }) => {
    const [x1, y1, x2, y2] = xyxy.map((v, i) =>
      i % 2 === 0 ? v * width : v * height
    );

    // const [x1, y1, w, h] = coco;

    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    // ctx.strokeRect(x1, y1, w, h);

    ctx.fillText(label, x1, y1 - 5);
  });

  const outputBuffer = canvas.toBuffer("image/png");
  writeFileSync(path.resolve(__dirname, "fixtures", "draw.png"), outputBuffer);
}

describe("from grgb to detection", () => {
  it("should convert grgb to rgb", async () => {
    const data = readFileSync(
      path.resolve(__dirname, "fixtures", "grgb-320-426.data")
    );

    const { rgbBuffer, originalWidth, originalHeight } = grgb2rgb(
      data,
      320,
      426
    );

    const rgb = await sharp(rgbBuffer, {
      raw: {
        width: originalWidth,
        height: originalHeight,
        channels: 3,
      },
    }).toFormat("jpeg");

    await rgb.toFile(path.resolve(__dirname, "fixtures", "catdog--rgb.jpeg"));

    const info = await rgb.metadata();

    assert.strictEqual(info.width, 640);
  });

  it("should predict", async () => {
    const session = await createSession();
    const image = await sharp(
      path.resolve(__dirname, "fixtures", "catdog--rgb.jpeg")
      // path.resolve(__dirname, "fixtures", "peoples.jpg")
    );

    const { data, info } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });

    const detections = await predict(
      session,
      0.5,
      data,
      info.width,
      info.height,
      info.channels
    );

    const jpegBuffer = await image.toFormat("jpeg").toBuffer();

    await drawDetection(jpegBuffer, detections, info.width, info.height);

    assert(detections.some((e) => e.label === "cat" || e.label === "dog"));
  });
});
