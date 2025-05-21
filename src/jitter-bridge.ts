import net from "node:net";
import { WebSocketServer } from "ws";
import wrtc from "@roamhq/wrtc";
import {
  DecodeJitMatrix,
  FrameChunkEncoder,
  grgbtorgb,
  bufferToMatrix,
  createJMLPBuffer,
  ParsedBuffer,
} from "./utils";

import MaxApi from "max-api";
import url from "url";

const Max: typeof MaxApi | undefined =
  process.env["MAX_ENV"] === "max" ? require("max-api") : undefined;

const config = {
  serverPort: process.argv
    .find((v) => v.includes("--server-port"))
    ?.split("=")[1],
  remotePort: process.argv
    .find((v) => v.includes("--remote-port"))
    ?.split("=")[1],
  wssPort: process.argv.find((v) => v.includes("--wss-port"))?.split("=")[1],

  secret:
    process.argv.find((v) => v.includes("--token"))?.split("=")[1] ||
    "mysecret",
};

console.log(config);

const connectedPeers = new Map<
  WebSocket,
  {
    peerConnection: RTCPeerConnection;
    dataChannel: RTCDataChannel;
  }
>();

const wss =
  config.wssPort &&
  new WebSocketServer({ port: Number.parseInt(config.wssPort) });

wss &&
  wss.on("connection", async (ws, req) => {
    console.log("WebSocket connected");
    const parameters = url.parse(req.url || "", true).query;
    const token = parameters.token;
    if (token !== config.secret) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const peerConnection = new wrtc.RTCPeerConnection();

    peerConnection.ondatachannel = (event) => {
      const dataChannel = event.channel;
      console.log("Server received data channel");

      dataChannel.onopen = () => {
        console.log("Server DataChannel is open");
        connectedPeers.set(ws, { peerConnection, dataChannel });
      };
      dataChannel.onclose = () => {
        console.log("Server DataChannel is closed");
        connectedPeers.delete(ws);
      };
    };

    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        ws.send(JSON.stringify({ type: "candidate", candidate }));
      }
    };

    // signaling
    ws.on("message", async (message) => {
      const msg = JSON.parse(message);

      switch (msg.type) {
        case "offer": {
          await peerConnection.setRemoteDescription(
            new wrtc.RTCSessionDescription(msg)
          );
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          ws.send(JSON.stringify(peerConnection.localDescription));
          break;
        }

        case "candidate": {
          await peerConnection.addIceCandidate(
            new wrtc.RTCIceCandidate(msg.candidate)
          );

          break;
        }

        case "object-detection": {
          Max && Max.outlet(msg);
          break;
        }

        default: {
          console.warn("Unknown message type:", msg.type);
          break;
        }
      }
    });

    ws.on("close", () => {
      console.log("WebSocket closed");
      const conn = connectedPeers.get(ws);
      if (conn) {
        conn.dataChannel.close();
        conn.peerConnection.close();
      }
      connectedPeers.delete(ws);
    });
  });

const socketServer = net.createServer((socket) => {
  const decodeJitMatrix = new DecodeJitMatrix();

  socket
    .pipe(decodeJitMatrix) // buffer to {data, dim, ...}
    .pipe(grgbtorgb) //  transfrom object to jpeg buffer
    .on("data", (parsedBuffer: ParsedBuffer) => {
      const now = performance.now();
      // Not sure if this is needed
      // tell [jit.net.send] a frame is received
      const { time: clientTime, serverStart } = parsedBuffer;
      const jmlpBuffer = createJMLPBuffer(clientTime, serverStart, now);
      socket.write(jmlpBuffer);

      try {
        for (const [, { dataChannel }] of connectedPeers.entries()) {
          if (dataChannel.readyState === "open") {
            dataChannel.send(parsedBuffer.data);
          }
        }
      } catch (err) {
        console.error("Datachannel Error:", err);
      }
    });
});

config.serverPort &&
  socketServer.listen(parseInt(config.serverPort), () =>
    console.log(`Socket Server: listening on port ${config.serverPort}.`)
  );

const client = new net.Socket();
config.remotePort &&
  client
    .connect(config.remotePort, () => {
      console.log("Socket Client: [jit.net.recv @port 7575] connected");
    })
    .on("error", (err) => {
      console.error("Socket Client: [jit.net.recv @port 7575] not connected");
    });
