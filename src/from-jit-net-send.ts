import net, { Socket } from "node:net";
import MaxApi from "max-api";
import { createSession, predict } from "./object-detection";
import { createJMLPBuffer, grgb2rgb, matrixToBuffer } from "./utils";

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

  socket.on("data", async (chunk) => {
    dataBuffer = Buffer.concat([dataBuffer, chunk]);

    try {
      while (true) {
        const matrixResult = matrixToBuffer(dataBuffer);
        if (!matrixResult) {
          break;
        }
        const { data, width, height, time: clientTime } = matrixResult;
        const baseTime = new Date().getTime();
        const correctedClientTime = baseTime + clientTime * 1000;

        // capture the data for future testing
        // writeFileSync("./grgbdata.rawdata", data);

        // clearup the processed data
        const totalSize = 288 + 8 + data.length;
        dataBuffer = dataBuffer.subarray(totalSize);

        const serverStart = Date.now();

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

        const serverEnd = Date.now();
        // console.log("clientTime ", correctedClientTime);
        // console.log("serverStart", serverStart);
        // console.log("serverEnd  ", serverEnd);
        // console.log(`Call to doSomething took ${serverEnd - serverStart} ms.`);

        const jmlpBuffer = createJMLPBuffer(
          correctedClientTime,
          serverStart,
          serverEnd
        );
        socket.write(jmlpBuffer);

        if (detections.length > 0) {
          Max && (await Max.outlet({ detections }));
        }
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
