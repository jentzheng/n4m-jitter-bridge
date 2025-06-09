import net from "node:net";
import wrtc from "@roamhq/wrtc";
import {
  DecodeJitMatrix,
  grgbtorgba,
  createJMLPBuffer,
  ParsedBuffer,
  rgbaBufferToMatrix,
  rotateRGBA,
} from "./utils";
import { io } from "socket.io-client";

import MaxApi from "max-api";

const Max: typeof MaxApi | undefined =
  process.env["MAX_ENV"] === "max" ? require("max-api") : undefined;

const config = {
  serverPort: process.argv
    .find((v) => v.includes("--server-port"))
    ?.split("=")[1],
  remoteServer:
    process.argv.find((v) => v.includes("--remote-server"))?.split("=")[1] ||
    "http://localhost:8080",
  roomId:
    process.argv.find((v) => v.includes("--roomID"))?.split("=")[1] ||
    "MaxMSPJitter",
};

console.log(config);

const socket = io("http://localhost:8080", {
  query: {
    name: "jitter-bridge-n4m",
    role: "host",
    roomId: config.roomId,
  },
});

socket.on("connect", async () => {
  socket.emit("join", config.roomId);
});

const peers = new Map<
  string,
  {
    pc: RTCPeerConnection;
    client?: net.Socket;
    jitRecvPort: number;
  }
>();

const videoSource = new wrtc.nonstandard.RTCVideoSource();
const videoTrack = videoSource.createTrack();
const stream = new wrtc.MediaStream();

socket.on("newUser", async (msg) => {
  const pc = new wrtc.RTCPeerConnection();

  if (peers.has(msg.from)) {
    peers.get(msg.from)?.pc.close();
    peers.delete(msg.from);
  }

  pc.addTrack(videoTrack, stream);
  const dataChannel = pc.createDataChannel("inferenceResult");

  pc.onnegotiationneeded = async (event) => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { description: pc.localDescription, to: msg.from });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { to: msg.from, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = (event) => {
    switch (pc.connectionState) {
      case "new": {
        break;
      }
      case "connecting": {
        break;
      }
      case "connected": {
        break;
      }
      case "failed": {
        pc.close();
        peers.delete(msg.from);
        console.log(
          `❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`
        );
        break;
      }
      case "disconnected": {
        pc.close();
        peers.delete(msg.from);
        console.log(
          `❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`
        );

        break;
      }
      case "closed": {
        pc.close();
        peers.delete(msg.from);
        console.log(
          `❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`
        );

        break;
      }
      default: {
        console.warn("Unknown connection state");
        break;
      }
    }
  };

  const client = new net.Socket();

  pc.ontrack = (event) => {
    console.log("📹 Got track from client", event.track.kind);
    const [track] = event.streams[0].getVideoTracks();
    const sink = new wrtc.nonstandard.RTCVideoSink(track);
    let lastFrame = 0;
    const minInterval = 1000 / 25;

    client
      .connect(msg.jitRecvPort)
      .on("connect", () => {
        sink.onframe = ({ frame }) => {
          const { width, height, data, rotation } = frame;
          // console.log(rotation); // 0, 90, 180, 270

          const now = performance.now();
          if (now - lastFrame < minInterval) return;
          lastFrame = now;

          // Frame is in I420 format, convert to RGBA
          const rgbaBuffer = new Uint8Array(width * height * 4); // 4 bytes per pixel
          wrtc.nonstandard.i420ToRgba(
            {
              width,
              height,
              data, // I420 raw data
            },
            {
              width,
              height,
              data: rgbaBuffer,
            }
          );

          const rotated = rotateRGBA(rgbaBuffer, width, height, rotation);

          const buffer = rgbaBufferToMatrix({
            width: rotated.width,
            height: rotated.height,
            data: rotated.data,
          });

          client.write(buffer);
        };
      })
      .on("error", (err) => {
        console.error(
          `❌ [jit.net.recv @port ${msg.jitRecvPort}] connection error`
        );
      });
  };

  peers.set(msg.from, { pc: pc, jitRecvPort: msg.jitRecvPort, client });
  console.log(`👏 socket.id ${msg.from} join, current peers ${peers.size}`);

  dataChannel.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case "object-detection": {
        Max && Max.outlet(msg);
        break;
      }
      default: {
        break;
      }
    }
  };
});

socket.on(
  "signal",
  async ({
    from,
    description,
    candidate,
  }: {
    from: string;
    description: wrtc.RTCSessionDescription;
    candidate: wrtc.RTCIceCandidate;
  }) => {
    const pc = peers.get(from)?.pc;
    if (!pc) return;

    if (description) {
      if (description.type === "answer") {
        await pc.setRemoteDescription(description);
      }
    } else if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  }
);

socket.on("requestOffer", async ({ from }) => {
  const pc = peers.get(from)?.pc;
  if (pc) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { description: pc.localDescription, to: from });
  }
});

socket.on("userLeft", (msg) => {
  const peer = peers.get(msg.from);
  if (peer) {
    peer.pc.close(); // close RTCPeerConnection
    peer.client?.destroy(); // close net socket client
    peers.delete(msg.from);
  }
  console.log(`👋 socket.id ${msg.from} left, current peers ${peers.size}`);
});

socket.on("disconnect", () => {
  console.log("socket disconnect");
  peers.forEach((peer) => {
    peer.pc.close();
    peer.client?.destroy(); // close net socket client
  });
  peers.clear();
});

socket.on("error", (err) => {
  console.error("SocketIO server error:", err.message);
  peers.clear();
});

socket.on("connect_error", (err) => {
  console.error("SocketIO server connect error:", err.message);
  peers.clear();
});

const socketServer = net.createServer((socket) => {
  const decodeJitMatrix = new DecodeJitMatrix();

  let lastPush = 0;
  const minInterval = 1000 / 25;

  socket
    .pipe(decodeJitMatrix) // buffer to {data, dim, ...}
    .pipe(grgbtorgba) //  transfrom object to rgba buffer
    .on("data", (parsedBuffer: ParsedBuffer) => {
      const now = performance.now();

      const { time: clientTime, serverStart, data, dim } = parsedBuffer;
      const jmlpBuffer = createJMLPBuffer(clientTime, serverStart, now);
      socket.write(jmlpBuffer); // Not sure if this is needed to tell [jit.net.send] a frame is received

      try {
        if (now - lastPush < minInterval) return;
        lastPush = now;

        const sourceFrame = {
          width: dim[1],
          height: dim[2],
          data: data,
        }; //rgba

        const i420Frame = {
          width: dim[1],
          height: dim[2],
          data: new Uint8Array(1.5 * dim[1] * dim[2]),
        };
        wrtc.nonstandard.rgbaToI420(sourceFrame, i420Frame);

        videoSource.onFrame(i420Frame);
      } catch (err) {
        console.error("Error:", err);
      }
    });
});

config.serverPort &&
  socketServer.listen(parseInt(config.serverPort), () =>
    console.log(`Socket Server: listening on port ${config.serverPort}.`)
  );
