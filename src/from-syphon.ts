import {
  SyphonOpenGLClient,
  SyphonServerDirectory,
  SyphonServerDirectoryListenerChannel,
} from "node-syphon";
import { createSession, predict } from "./object-detection";
import MaxApi from "max-api";

let Max: typeof MaxApi | undefined;

if (process.env["MAX_ENV"] === "max") {
  Max = require("max-api");
} else {
  Max = undefined;
}

const directory = new SyphonServerDirectory();

type Frame = {
  buffer: Buffer;
  width: number;
  height: number;
};

let debounceTimeout: NodeJS.Timeout | null = null;

directory.on(
  SyphonServerDirectoryListenerChannel.SyphonServerAnnounceNotification,
  async (server) => {
    console.log("Server announce", server);
    const targetServer = directory.servers.find(
      (e) => e.SyphonServerDescriptionNameKey === "fromMax"
    );
    const client = new SyphonOpenGLClient(targetServer);

    const session = await createSession();

    client.on("frame", async (frame: Frame) => {
      const buffer = frame.buffer;
      const width = frame.width;
      const height = frame.height;

      // const detections = await predict(
      //   session,
      //   0.5,
      //   buffer,
      //   width,
      //   height,
      //   4,
      //   true
      // );
      // if (detections.length > 0) {
      //   Max && (await Max.outlet({ detections }));
      // }
    });
  }
);

directory.on(
  SyphonServerDirectoryListenerChannel.SyphonServerRetireNotification,
  (server: any) => {
    console.log("Server retire", server);
    console.log(directory.servers);
  }
);

directory.listen();

process.on("SIGINT", () => {
  console.log("Received SIGINT. Exiting process...");
  directory.dispose();
  process.exit(0); // Exit the process with a success code
});
