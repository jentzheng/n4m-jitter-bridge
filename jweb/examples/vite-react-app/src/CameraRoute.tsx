import React, { useRef, useState, useEffect, useCallback } from "react";
import { useConnection } from "./hooks";

export const CameraRoute = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const { dataChannelRef } = useConnection();

  useEffect(() => {
    // grab input devices
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      setVideoDevices(videoInputs);
      if (videoInputs.length > 0) {
        setSelectedDeviceId(videoInputs[0].deviceId);
      }
    });
  }, []);

  const handleStartWebcam = useCallback(async () => {
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
    }

    if (selectedDeviceId) {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedDeviceId,
          facingMode: "environment",
          width: { min: 1920 },
          height: { min: 1080 },
        },
      });
      setStream(mediaStream);
    }
    // eslint-disable-next-line
  }, [selectedDeviceId]);

  const handleStopWebcam = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        console.log("Camera unmounted");
      }
    };
  }, [stream]);

  useEffect(() => {
    if (selectedDeviceId) {
      handleStartWebcam();
    }

    // eslint-disable-next-line
  }, [selectedDeviceId, dataChannelRef]);

  useEffect(() => {
    let stopped = false;
    let timeoutId: number;
    const fps = 30;

    async function captureLoop() {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        timeoutId = window.setTimeout(captureLoop, 1000 / fps);
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width === 0 || height === 0) {
        timeoutId = window.setTimeout(captureLoop, 1000 / fps);
        return;
      }
      const offscreen = new window.OffscreenCanvas(width, height);
      const ctx = offscreen.getContext("2d");
      ctx?.drawImage(video, 0, 0, width, height);

      const blob = await offscreen.convertToBlob({
        type: "image/jpeg",
        quality: 0.8,
      });
      const arrayBuffer = await blob.arrayBuffer();

      if (
        dataChannelRef.current &&
        dataChannelRef.current.readyState === "open" &&
        dataChannelRef.current.bufferedAmount < 2 * 1024 * 1024
      ) {
        dataChannelRef.current.send(arrayBuffer);
      }

      timeoutId = window.setTimeout(captureLoop, 1000 / fps);
    }

    captureLoop();

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
  }, [stream, dataChannelRef]);

  return (
    <div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="block max-w-full w-full h-auto bg-gray-500 max-h-screen"
      />

      <div className="flex ">
        <select
          id="videoSource"
          className="select"
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {videoDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${device.deviceId}`}
            </option>
          ))}
        </select>

        <button className="btn" onClick={() => handleStartWebcam()}>
          start
        </button>
        <button className="btn" onClick={() => handleStopWebcam()}>
          stop
        </button>
      </div>
    </div>
  );
};
