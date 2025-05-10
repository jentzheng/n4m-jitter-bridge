import sharp from "sharp";
import { InferenceSession, Tensor } from "onnxruntime-node";
import path from "node:path";

const modelPath = path.join(__dirname, "../models", "yolo12n-withnms.onnx");
const modelDim = [1, 3, 640, 640];
const { labels } = require("../models/labels.json");

export async function createSession() {
  return await InferenceSession.create(modelPath);
}

async function prepareImageTensorFromRGB(
  rgbBuffer: Buffer,
  width: number,
  height: number,
  channels: 1 | 2 | 3 | 4 = 3,
  isFlip: boolean
) {
  const modelWidth = modelDim[2];
  const modelHeight = modelDim[3];

  // Resize and remove alpha
  const resized = await sharp(rgbBuffer, {
    raw: { width, height, channels: channels },
  })
    .resize(modelWidth, modelHeight, {
      fit: "contain",
    })
    .removeAlpha()
    .flip(isFlip)
    .raw()
    .toBuffer();

  // normalize
  const floatArray = new Float32Array(resized);
  const pixelCount = modelWidth * modelHeight;

  for (let i = 0; i < pixelCount; i++) {
    const r = resized[i * 3];
    const g = resized[i * 3 + 1];
    const b = resized[i * 3 + 2];
    floatArray[i] = r / 255.0; // R
    floatArray[i + pixelCount] = g / 255.0; // G
    floatArray[i + pixelCount * 2] = b / 255.0; // B
  }

  const tensor = new Tensor("float32", floatArray, modelDim);

  return tensor;
}

export type Detection = {
  xyxy: [number, number, number, number];
  coco: [number, number, number, number];
  score: number;
  label: string;
};

function postProcess(
  output,
  labels,
  scoreThreshold = 0.5,
  padLeft: number,
  padTop: number,
  scale: number,
  imageWidth: number,
  imageHeight: number
) {
  const detections: Detection[] = [];
  for (let i = 0; i < output.length; i += 6) {
    let x1 = output[i];
    let y1 = output[i + 1];
    let x2 = output[i + 2];
    let y2 = output[i + 3];
    const score = output[i + 4];
    const classIndex = output[i + 5];

    if (score < scoreThreshold) continue;

    // Adjust coordinates based on scale and padding
    x1 = Math.round((x1 - padLeft) / scale);
    y1 = Math.round((y1 - padTop) / scale);
    x2 = Math.round((x2 - padLeft) / scale);
    y2 = Math.round((y2 - padTop) / scale);

    const label = labels[classIndex] || "unknown";

    // Normalize xyxy coordinates
    const xminNorm = x1 / imageWidth;
    const yminNorm = y1 / imageHeight;
    const xmaxNorm = x2 / imageWidth;
    const ymaxNorm = y2 / imageHeight;

    detections.push({
      xyxy: [xminNorm, yminNorm, xmaxNorm, ymaxNorm], //xyxy normalized
      coco: [x1, y1, x2 - x1, y2 - y1], //xmin, ymin, width, height in pixel
      score,
      label,
    });
  }
  return detections;
}

export async function predict(
  session: InferenceSession,
  threshold: number,
  imageBuffer: Buffer<ArrayBuffer>,
  width: number,
  height: number,
  channels: 1 | 2 | 3 | 4,
  isFlip: boolean = false
) {
  const scale = Math.min(modelDim[2] / width, modelDim[3] / height);
  const resizedWidth = Math.round(width * scale);
  const resizedHeight = Math.round(height * scale);
  const padLeft = Math.floor((modelDim[2] - resizedWidth) / 2);
  const padTop = Math.floor((modelDim[3] - resizedHeight) / 2);

  const inputTensor = await prepareImageTensorFromRGB(
    imageBuffer,
    width,
    height,
    channels,
    isFlip
  );

  session.startProfiling();
  const { output0 } = await session.run({ images: inputTensor });
  session.endProfiling();

  const detections = postProcess(
    output0.data,
    labels,
    threshold,
    padLeft,
    padTop,
    scale,
    width,
    height
  );

  return detections;
}
