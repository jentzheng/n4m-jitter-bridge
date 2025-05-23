import { useEffect, useRef, useMemo } from "react";
import { useConnection } from "./hooks";
import DetectorWorker from "./utils/worker-object-detection?worker&inline";

type Result = {
  type: string;
  detections:
    | [
        {
          bbox: [number, number, number, number];
          coco: [number, number, number, number];
          score: number;
          label: string;
        }
      ]
    | [];
};

export const DetectionRoute = () => {
  const { dataChannelRef, wsRef, connectionState } = useConnection();

  const canvasEle = useRef<HTMLCanvasElement>(null);

  const detectorWorker = useMemo(() => new DetectorWorker(), []);

  useEffect(() => {
    let lastDraw = 0;
    let timeoutId: number | null = null;

    detectorWorker.onmessage = (event: MessageEvent<Result>) => {
      const now = Date.now();
      const interval = 1000 / 5;

      if (now - lastDraw < interval) {
        if (timeoutId) clearTimeout(timeoutId);

        timeoutId = window.setTimeout(() => {
          drawResult(event.data);
          lastDraw = Date.now();
        }, interval - (now - lastDraw));

        wsRef.current?.send(JSON.stringify(event.data));
      } else {
        drawResult(event.data);
        lastDraw = now;
      }
    };

    function drawResult(result: Result) {
      const canvas = canvasEle.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.font = "16px monospace";
      ctx.fillStyle = "#00FF00";

      result.detections.forEach((det) => {
        const [x1, y1, w, h] = det.coco;
        ctx.beginPath();
        ctx.rect(x1, y1, w, h);
        ctx.stroke();
        ctx.fillText(
          `${det.label} ${(det.score * 100).toFixed(1)}%`,
          x1,
          y1 > 20 ? y1 - 5 : y1 + 15
        );
      });
      ctx.restore();
    }

    return () => {
      detectorWorker.onmessage = null;
      detectorWorker.terminate();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [detectorWorker, wsRef]);

  useEffect(() => {
    const dc = dataChannelRef.current;
    if (!dc || !connectionState.isDCopened) return;
    dc.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
      const canvas = canvasEle.current;
      if (!canvas) return;
      const blob = new Blob([event.data], { type: "image/jpeg" });
      detectorWorker.postMessage(blob);
      const bitmap = await createImageBitmap(blob);
      const ctx = canvas.getContext("2d");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx?.drawImage(bitmap, 0, 0);
    };
    return () => {
      dc.onmessage = null;
    };
  }, [connectionState, dataChannelRef, detectorWorker]);

  return (
    <div className="relative   h-fit ">
      <canvas
        ref={canvasEle}
        className="block max-w-full w-full h-auto bg-gray-500"
      />
    </div>
  );
};
