import net, { Socket } from "node:net";
import MaxApi from "max-api";
import { createSession, predict } from "./object-detection";
import { createJMLPBuffer, grgb2rgb, matrixToBuffer } from "./utils";
import { writeFileSync } from "node:fs";

let Max: typeof MaxApi | undefined;

if (process.env["MAX_ENV"] === "max") {
  Max = require("max-api");
} else {
  Max = undefined;
}

const handleSocket = async (socket: Socket) => {
  console.log("client connected");

  const session = await createSession(); //create ort.InferenceSession

  let dataBuffer: Buffer<ArrayBuffer> = Buffer.alloc(0); // Initialize buffer to accumulate data

  server.on("connection", (stream) => {
    console.log("someone connected!", stream);
  });

  socket.on("data", async (chunk) => {
    dataBuffer = Buffer.concat([dataBuffer, chunk]);

    try {
      while (true) {
        const matrixResult = matrixToBuffer(dataBuffer);
        if (!matrixResult) {
          break;
        }
        const { data, width, height, time: clientTime } = matrixResult;

        // capture the data for future testing
        // writeFileSync("./grgbdata.rawdata", data);
        // clearup the processed data

        const totalSize = 288 + 8 + data.length;
        dataBuffer = dataBuffer.subarray(totalSize);

        const serverStart = performance.now();

        //GRGB to RGB
        const { rgbBuffer, originalWidth, originalHeight } = grgb2rgb(
          data,
          width,
          height
        );

        const detections = await predict(
          session,
          0.5,
          rgbBuffer,
          originalWidth,
          originalHeight,
          3
        );

        const serverEnd = performance.now();

        if (detections.length > 0) {
          Max && (await Max.outlet({ detections }));
        }

        // console.log(serverStart, serverEnd);
        const jmlpBuffer = createJMLPBuffer(clientTime, serverStart, serverEnd);
        socket.write(jmlpBuffer);
      }
    } catch (err: unknown) {
      console.error("Error during prediction:", err);
    }
  });

  socket.on("end", async () => {
    await session.release();
    console.log("Client disconnected.");
  });
};

const server = net.createServer(handleSocket);
server.listen(7474, () => console.log("Server listening on port 7474."));

export { grgb2rgb };
