# n4m-jitter-bridge

![screenshot](/screenshot.png)

This is a Node.js-based example designed to facilitate communication between Max/MSP and external machine learning or image processing systems. It provides utilities for handling image data, performing object detection, and managing data streams from Max/MSP's **jit.net.send**.

## Features

- **GRGB to RGB Conversion**: Converts GRGB image data from Jitter into standard RGB format.
- **Object Detection**: Integrates with a machine learning model to perform object detection on image data.
- **Data Handling**: Parses and processes image data streams from Jitter's **jit.net.send**.
- **Max/MSP Integration**: Communicates with Max/MSP using `max-api` for real-time data exchange.

## Installation

1. Clone the repository:

```sh
cd ~/Documents/Max\ 9/Library
git clone https://github.com/jentzheng/n4m-jitter-bridge.git
```

2. Install dependencies:

```sh
pnpm install && pnpm run build
# or
npm install && npm run build
```

3. Open the Max patch.

## Usage

### From Jitter's jit.net.send

- **Workflow**:
  - Receives GRGB image data.
  - Converts it to RGB using `grgb2rgb`.
  - Runs YOLOv12n on the RGB data.
  - Sends detection results back to Max/MSP.

## TODO

- Should I use `node-addon-api` to parse the data from Jitter?
- Evaluate `from-syphon.ts` (not sure if it's reasonable for live processing as it allocates too much memory).