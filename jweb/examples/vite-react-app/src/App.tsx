import { useState, useEffect, useRef } from "react";

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const detectorWorkerRef = useRef<Worker | null>(null);
  const latestResultsRef = useRef<{
    type: string;
    detections:
      | [
          {
            bbox: [number, number, number, number];
            coco: [number, number, number, number];
            score: number;
          }
        ]
      | [];
  }>({
    type: "",
    detections: [],
  });
  const [drawFps] = useState(5);

  const { hostname } = window.location;

  // const [status, setStatus] = useOptimistic()
  const [connectionState, setConnectionState] = useState({
    address: `ws://${hostname ?? "localhost"}:8080?token=mysecret`,
    isWSconnected: false,
    isDCopened: false,
  });

  const canvasEle = useRef<HTMLCanvasElement>(null);
  const resultCanvasEle = useRef<HTMLCanvasElement>(null);

  const initConnection = (address: string) => {
    const detectorWorker = new Worker(
      new URL("./utils/worker-object-detection.ts", import.meta.url),
      { type: "module" }
    );
    detectorWorkerRef.current = detectorWorker;

    const ws = new WebSocket(address);
    wsRef.current = ws;
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // ask for video track
    // pc.addTransceiver("video", { direction: "recvonly" });
    // pc.da

    ws.onopen = async () => {
      console.log("[WebSocket] connected");
      setConnectionState((val) => {
        return {
          ...val,
          isWSconnected: true,
        };
      });

      const offer = await pc.createOffer();
      console.log("offer:", offer);

      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify(offer));
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "answer": {
            console.log(msg);
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
            break;
          }

          case "candidate": {
            console.log(msg);

            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            break;
          }

          default: {
            console.warn("Unknown message type:", msg.type);
            break;
          }
        }
      }
    };

    ws.onclose = () => {
      console.log("[WebSocket] closed");
      setConnectionState((val) => {
        return {
          ...val,
          isWSconnected: false,
        };
      });
    };

    ws.onerror = (e) => {
      console.error("[WebSocket] error", e);
    };

    // send candidate to remote
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("CLIENT: Sending ICE candidate to server");
        ws.send(JSON.stringify({ type: "candidate", candidate }));
      }
    };

    pc.onnegotiationneeded = (event) => {
      console.log("negotiationneeded", event);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("PC state:", pc.connectionState);
    };

    const dataChannel = pcRef.current.createDataChannel("frames", {});
    dataChannel.binaryType = "arraybuffer";
    dataChannelRef.current = dataChannel;

    dataChannel.onopen = () => {
      setConnectionState((val) => {
        return {
          ...val,
          isDCopened: true,
        };
      });

      console.log("[WebRTC] DataChannel is open");
    };

    dataChannel.onclose = () => {
      console.log("[WebRTC] DataChannel closed");

      setConnectionState((val) => {
        return {
          ...val,
          isDCopened: false,
        };
      });
    };

    dataChannel.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
      const canvas = canvasEle.current;
      const resultCanvas = resultCanvasEle.current;
      const blob = new Blob([event.data], { type: "image/jpeg" });

      detectorWorker.postMessage(blob);
      const bitmap = await createImageBitmap(blob);
      // console.log(bitmap);

      if (canvas && resultCanvas) {
        const ctx = canvas.getContext("2d");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        resultCanvas.width = bitmap.width;
        resultCanvas.height = bitmap.height;
        ctx?.drawImage(bitmap, 0, 0);
      }
    };

    detectorWorker.onmessage = (event) => {
      ws.send(JSON.stringify(event.data));
      latestResultsRef.current = event.data;
    };
  };

  const disconnect = () => {
    if (detectorWorkerRef.current) {
      detectorWorkerRef.current.terminate();
      detectorWorkerRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // init connection
  useEffect(() => {
    initConnection(connectionState.address);
    return () => {
      disconnect();
    };
  }, [connectionState.address]);

  // drawCanvas
  useEffect(() => {
    let lastDraw = 0;
    let rafId: number;

    function drawLoop() {
      const now = performance.now();

      if (now - lastDraw > 1000 / drawFps) {
        const resultCanvas = resultCanvasEle.current;
        const result = latestResultsRef.current;

        if (resultCanvas && result.detections.length > 0) {
          const { type, detections } = result;

          const ctx = resultCanvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
            ctx.strokeStyle = "#00FF00";
            ctx.lineWidth = 2;
            ctx.font = "16px monospace";
            ctx.fillStyle = "#00FF00";
            detections.forEach((det) => {
              const [x1, y1, w, h] = det.coco;
              ctx.beginPath();
              ctx.rect(x1, y1, w, h);
              ctx.stroke();
              ctx.fillText(
                `id:${det.id} ${(det.score * 100).toFixed(1)}%`,
                x1,
                y1 > 20 ? y1 - 5 : y1 + 15
              );
            });
          }
        }
        lastDraw = now;
      }
      rafId = requestAnimationFrame(drawLoop);
    }
    rafId = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFps]);

  return (
    <div className="App h-screen">
      <form
        action={(formdata) => {
          const address = formdata.get("address");
          if (connectionState.isWSconnected) {
            disconnect();
          } else if (address) {
            setConnectionState((val) => {
              return {
                ...val,
                address: address as string,
              };
            });
            initConnection(address as string);
          }
        }}
      >
        <div className="flex">
          <label
            id="address"
            htmlFor="address"
            className="flex-auto   border-gray-300  sm:text-sm"
          >
            <span className="hidden">address</span>
            <input
              id="address"
              name="address"
              type="url"
              className="bg-white w-full border-1 border-gray-300 py-1 px-2  text-sm"
              placeholder="ws://localhost:8080"
              defaultValue={connectionState.address}
              required
            />
          </label>

          <button
            type="submit"
            className="inline-block  border border-indigo-600 bg-indigo-600 px-1 py-1 text-sm font-medium text-white hover:bg-transparent hover:text-indigo-600 "
          >
            {connectionState.isWSconnected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </form>

      <div className="flex bg-gray-600">
        <div className="relative w-fit h-fit flex-1/3">
          <canvas
            ref={canvasEle}
            className="block max-w-full h-auto bg-gray-500"
          />
          <canvas
            ref={resultCanvasEle}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
          />
        </div>

        <div className="flex-2/3 p-2 text-sm text-white font-mono">
          <ul>
            <li>
              {connectionState.isWSconnected
                ? `${connectionState.address} Connected`
                : "Websocket Disconnected"}
            </li>
            <li>
              DataChannel: {connectionState.isDCopened ? "Opened" : "Closed"}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
