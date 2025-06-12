import { useEffect, useRef, useMemo } from "react";
import { useConnection } from "./utils/hooks";
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
  const { dc, remoteStream } = useConnection();
  const videoEle = useRef<HTMLVideoElement>(null);
  const canvasEle = useRef<HTMLCanvasElement>(null);
  const detectorWorker = useMemo(() => new DetectorWorker(), []);
  const lastResultRef = useRef<Result>(null);

  useEffect(() => {
    const video = videoEle.current;
    const canvas = canvasEle.current;

    if (!video || !canvas || !remoteStream || !dc) return;

    video.srcObject = remoteStream;
    video.play();

    const ctx = canvas.getContext("2d");

    function drawResult(ctx: CanvasRenderingContext2D) {
      const result = lastResultRef.current;
      if (!result) return;

      ctx.save();
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.font = "16px monospace";
      ctx.fillStyle = "#00FF00";

      result.detections?.forEach((det) => {
        const [x, y, w, h] = det.coco;
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.fillText(det.label, x, y - 4);
      });

      ctx.restore();
    }

    let rid = 0;

    async function captureLoop() {
      if (!video || !canvas || !ctx) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      ctx.drawImage(video, 0, 0);

      const rawImage = {
        data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width,
        height: canvas.height,
        channels: 4,
      };

      detectorWorker.postMessage(rawImage);

      drawResult(ctx);

      rid = requestAnimationFrame(captureLoop);
    }

    video.onloadeddata = () => {
      rid = requestAnimationFrame(captureLoop);
    };

    detectorWorker.onmessage = (event: MessageEvent) => {
      dc.send(JSON.stringify(event.data));
      lastResultRef.current = event.data;
    };

    return () => {
      cancelAnimationFrame(rid);
      detectorWorker.onmessage = null;
      detectorWorker.terminate();
      console.info("DetectionRoute unmounted");
    };
  }, [remoteStream, detectorWorker, dc]);

  return (
    <>
      <video ref={videoEle} autoPlay playsInline muted className="hidden" />
      <canvas
        ref={canvasEle}
        className="block max-w-full  w-full m-auto bg-black "
      />
    </>
  );
};
