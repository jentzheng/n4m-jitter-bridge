/// <reference lib="webworker" />
import {
  RawImage,
  AutoModel,
  AutoProcessor,
  env,
} from "@huggingface/transformers";

// env.allowLocalModels = true;
// env.allowRemoteModels = false;
env.localModelPath = "/models";

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

const YOLO_LABELS = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
];

(async () => {
  const hasWebGPU =
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    // @ts-ignore
    (await navigator.gpu.requestAdapter()) !== null;

  const deviceType = hasWebGPU ? "webgpu" : "wasm";

  const model = await AutoModel.from_pretrained("onnx-community/yolov10n", {
    device: deviceType,
    progress_callback: (info) => {
      self.postMessage({ modelInfo: info });
    },
  });

  const processor = await AutoProcessor.from_pretrained(
    "onnx-community/yolov10n",
    {
      device: ["webgpu"],
    }
  );
  console.log("Worker initialized");

  let isProcessing = false;

  self.addEventListener(
    "message",
    async (
      event: MessageEvent<{
        data: Uint8ClampedArray<ArrayBufferLike>;
        width: number;
        height: number;
        channels: 1 | 2 | 3 | 4;
      }>
    ) => {
      if (isProcessing) {
        return;
      }
      isProcessing = true;
      const { data, width, height, channels } = event.data;

      try {
        const image = new RawImage(data, width, height, channels);

        const { pixel_values, reshaped_input_sizes } = await processor(image);
        const { output0 } = await model({ images: pixel_values });
        const predictions = output0.tolist()[0];
        pixel_values.dispose();
        output0.dispose();

        const threshold = 0.5;
        const [newHeight, newWidth] = reshaped_input_sizes[0]; // Reshaped height and width
        const [xs, ys] = [image.width / newWidth, image.height / newHeight]; // x and y resize scales

        const result = predictions.reduce(
          (acc: any[], pred: number[], _idx: number, _arr: number[]) => {
            const [xmin, ymin, xmax, ymax, score, id] = pred;

            if (score > threshold) {
              const bbox = [xmin * xs, ymin * ys, xmax * xs, ymax * ys];

              const coco = [
                bbox[0],
                bbox[1],
                bbox[2] - bbox[0],
                bbox[3] - bbox[1],
              ].map((e) => Math.round(e)); // coco format

              const xyxy = bbox.map((e, i) => {
                return i % 2 === 0 ? e / image.width : e / image.height;
              }); // normalized xyxy format

              const label = YOLO_LABELS[id] ?? String(id);

              acc.push({ bbox, coco, xyxy, score, label });
            }

            return acc;
          },
          []
        );

        self.postMessage({ type: "object-detection", detections: result });
      } catch (err) {
        self.postMessage({ error: String(err) });
      } finally {
        isProcessing = false;
      }
    }
  );
})();
