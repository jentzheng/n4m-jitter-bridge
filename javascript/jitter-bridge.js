"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = __importDefault(require("node:net"));
const wrtc_1 = __importDefault(require("@roamhq/wrtc"));
const utils_1 = require("./utils");
const socket_io_client_1 = require("socket.io-client");
const Max = process.env["MAX_ENV"] === "max" ? require("max-api") : undefined;
const config = {
    serverPort: process.argv
        .find((v) => v.includes("--server-port"))
        ?.split("=")[1],
    remoteServer: process.argv.find((v) => v.includes("--remote-server"))?.split("=")[1] ||
        "http://localhost:5173",
    roomId: process.argv.find((v) => v.includes("--roomID"))?.split("=")[1] ||
        "MaxMSPJitter",
};
console.log(config);
const socket = (0, socket_io_client_1.io)(config.remoteServer, {
    query: {
        name: "jitter-bridge-n4m",
        role: "host",
        roomId: config.roomId,
    },
});
socket.on("connect", async () => {
    socket.emit("join", config.roomId);
});
const peers = new Map();
const videoSource = new wrtc_1.default.nonstandard.RTCVideoSource();
const videoTrack = videoSource.createTrack();
const stream = new wrtc_1.default.MediaStream();
socket.on("newUser", async (msg) => {
    const pc = new wrtc_1.default.RTCPeerConnection();
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
                console.log(`❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`);
                break;
            }
            case "disconnected": {
                pc.close();
                peers.delete(msg.from);
                console.log(`❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`);
                break;
            }
            case "closed": {
                pc.close();
                peers.delete(msg.from);
                console.log(`❗ Peer connection for ${msg.from} closed due to connectionState: ${pc.connectionState}`);
                break;
            }
            default: {
                console.warn("Unknown connection state");
                break;
            }
        }
    };
    const client = new node_net_1.default.Socket();
    pc.ontrack = (event) => {
        console.log("📹 Got track from client", event.track.kind);
        const [track] = event.streams[0].getVideoTracks();
        const sink = new wrtc_1.default.nonstandard.RTCVideoSink(track);
        let lastFrame = 0;
        const minInterval = 1000 / 25;
        client
            .connect(msg.jitRecvPort)
            .on("connect", () => {
            sink.onframe = ({ frame }) => {
                const { width, height, data, rotation } = frame;
                // console.log(rotation); // 0, 90, 180, 270
                // const now = performance.now();
                // if (now - lastFrame < minInterval) return;
                // lastFrame = now;
                const uyuyBuffer = (0, utils_1.i420ToUYVYBufferWithRotation)({
                    width: width,
                    height: height,
                    data: data,
                    rotation
                });
                const matrixBuffer = (0, utils_1.bufferToMatrix)({
                    data: uyuyBuffer.data,
                    width: uyuyBuffer.width / 2,
                    height: uyuyBuffer.height,
                });
                client.write(matrixBuffer);
            };
        })
            .on("error", (err) => {
            console.error(`❌ [jit.net.recv @port ${msg.jitRecvPort}] connection error`);
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
socket.on("signal", async ({ from, description, candidate, }) => {
    const pc = peers.get(from)?.pc;
    if (!pc)
        return;
    if (description) {
        if (description.type === "answer") {
            await pc.setRemoteDescription(description);
        }
    }
    else if (candidate) {
        await pc.addIceCandidate(candidate);
    }
});
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
const socketServer = node_net_1.default.createServer((socket) => {
    const decodeJitMatrix = new utils_1.DecodeJitMatrix();
    let lastPush = 0;
    const minInterval = 1000 / 25;
    socket
        .pipe(decodeJitMatrix) // buffer to {data, dim, ...}
        .pipe(utils_1.uyvytoi420) //  transfrom object to i420 buffer
        .on("data", (parsedBuffer) => {
        const now = performance.now();
        const { time: clientTime, serverStart, data, dim } = parsedBuffer;
        const jmlpBuffer = (0, utils_1.createJMLPBuffer)(clientTime, serverStart, now);
        socket.write(jmlpBuffer); // Not sure if this is needed to tell [jit.net.send] a frame is received
        videoSource.onFrame({ data, width: dim[1], height: dim[2] });
    });
});
config.serverPort &&
    socketServer.listen(parseInt(config.serverPort), () => console.log(`Socket Server: listening on port ${config.serverPort}.`));
