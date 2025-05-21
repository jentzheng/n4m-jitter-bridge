# n4m-jitter-bridge

![screenshot](/screenshot.png)

**n4m-jitter-bridge** is a Node.js-based bridge for real-time communication between Max/MSP/Jitter and web clients. It enables low-latency streaming of Jitter matrix data (video frames) to browsers, supporting both object detection and custom data handling.

A key component is `Transformers.js`, which leverages WebGPU for inference in the browser. You can also dedicate the inference task to a second computer—simply run the web client on another machine and connect it to the bridge, offloading heavy ML inference from your main Max/Jitter workstation.

## Features

- **GRGB to RGB/JPEG Conversion**: Converts Jitter's GRGB image data to standard RGB, then encodes as JPEG for efficient transmission.
- **Low-Latency Streaming**: Streams video frames from Jitter to browsers using WebRTC DataChannel (P2P, ultra-low latency).
- **WebSocket Signaling**: Uses WebSocket for signaling and authentication.
- **Max/MSP Integration**: Communicates with Max/MSP using `max-api` for real-time data exchange and feedback.

## Installation

Clone the repository:

```sh
cd ~/Documents/Max\ 9/Library
git clone https://github.com/jentzheng/n4m-jitter-bridge.git
```

Install dependencies:

```sh
// server side
pnpm install && pnpm run build
# or
npm install && npm run build
```

## Usage

Start the Node.js Bridge

```sh
node src/jitter-bridge.js --server-port=7474 --wss-port=8080 --token=mysecret
```

In Max/MSP/Jitter
- open `objectdetection.maxpat`
- Use [jit.net.send] to send matrix data to the bridge's TCP port.
- Example: [jit.net.send @host 127.0.0.1 @port 7474]

In the Browser

```sh
cd jweb/examples/vite-react-app
npm install
npm run build
npx vite preview
```

- Open <http://localhost:4173> in your browser.
- The app will auto-connect to the bridge using the current host and port.

Real-Time Video & Detection

- The browser receives JPEG frames via WebRTC DataChannel and renders them to a canvas.
- Object detection results (if enabled) are displayed or sent back to Max/MSP.

## TODO and questions

- Add more model inference examples like YOLO-pose or YOLO-seg
- concat multiple image segmentation and send it back to serverside
- ~~Should I use `node-addon-api` to parse the data from Jitter?~~
- ~~Evaluate `from-syphon.ts` (not sure if it's suitable for live processing as it allocates too much memory).~~

