# n4m-jitter-bridge

![screenshot](/screenshot.png)

This is a Node.js-based example designed to facilitate communication between Jitter's matrix and external machine learning like ONNX js or Tensorflow js. It provides utilities for handling image data, performing object detection, and managing data streams from Max/MSP/Jitter's **jit.net.send**.

## Features

- **GRGB to RGB Conversion**: Converts GRGB image data from Jitter into standard RGB format.
- **Object Detection**: Integrates with a machine learning model to perform object detection on image data.
- **Data Handling**: Parses and processes image data streams from Jitter's **jit.net.send**.
- **Max/MSP Integration**: Communicates with Max/MSP using `max-api` for real-time data exchange.

## Installation

Clone the repository:

```sh
cd ~/Documents/Max\ 9/Library
git clone https://github.com/jentzheng/n4m-jitter-bridge.git
```

Install dependencies:

```sh
pnpm install && pnpm run build
# or
npm install && npm run build
```

## Usage

### From Jitter's jit.net.send

- **Workflow**:
  - Parse data from Jitter
  - Converts it to RGB using `grgb2rgb`.
  - Runs YOLOv12n on the RGB data.
  - Sends detection results back to Max/MSP.

## TODO and questions

- Add more model inference examples like YOLO-pose or YOLO-seg
- Should I use `node-addon-api` to parse the data from Jitter?
- Evaluate `from-syphon.ts` (not sure if it's suitable for live processing as it allocates too much memory).
- Is it possible to send real-time base64 data, such as image segments, back to Max?