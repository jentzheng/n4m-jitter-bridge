import { Transform, TransformCallback } from "node:stream";
import wrtc from "@roamhq/wrtc";

export type ParsedBuffer = {
  time: number;
  serverStart: number;
  type: string;
  dim: [number, number, number];
  data: Buffer;
};

export class DecodeJitMatrix extends Transform {
  private buffer: Buffer = Buffer.alloc(0);

  constructor() {
    super({ readableObjectMode: true });
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const serverStart = performance.now();

    while (this.buffer.length > 8) {
      const chunkId = this.buffer.toString("ascii", 0, 4);
      const headerSize = this.buffer.readUInt32LE(4);
      const totalHeaderChunkSize = 8 + headerSize;

      if (chunkId !== "JMTX") {
        this.buffer = this.buffer.subarray(totalHeaderChunkSize); // skip
        continue;
      }

      if (this.buffer.length < totalHeaderChunkSize) break;

      if (chunkId === "JMTX") {
        const typeMap = new Map<number, string>([
          [0, "char"],
          [1, "long"],
          [2, "float32"],
          [3, "float64"],
        ]);

        const headerBody = this.buffer.subarray(8, totalHeaderChunkSize);
        const datasize = this.buffer.readUInt32BE(8 + 276);

        const totalMatrixPacketSize = totalHeaderChunkSize + datasize;
        const time = headerBody.readDoubleBE(280);
        const planecount = headerBody.readUInt32BE(8);
        const type = typeMap.get(headerBody.readUInt32BE(12));
        const dim = Array.from({ length: 32 }, (_, i) =>
          headerBody.readInt32BE(20 + i * 4)
        );

        if (this.buffer.length < totalMatrixPacketSize) {
          // console.log("loading:", this.buffer.length, totalMatrixPacketSize);
          break;
        }
        // console.log("loaded:", this.buffer.length, totalMatrixPacketSize);
        const matrixData = this.buffer.subarray(
          totalHeaderChunkSize,
          totalMatrixPacketSize
        );

        // push to next pipe
        this.push({
          time: time,
          serverStart,
          type,
          dim: [planecount, ...dim.slice(0, 2)],
          data: matrixData,
        });

        // clearup buffer
        this.buffer = this.buffer.subarray(totalMatrixPacketSize);
      }
    }

    callback();
  }
}

export const grgbtorgba = new Transform({
  writableObjectMode: true,
  readableObjectMode: true,
  async transform(chunk: ParsedBuffer, _encoding, callback) {
    const { time, serverStart, type, dim, data: grgbBuffer } = chunk;
    const [_planecount, width, height] = dim;

    const restoredWidth = width * 2;
    const rgbaBuffer = Buffer.alloc(restoredWidth * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const grgbIndex = (y * width + x) * 4;
        const rgbaIndex = (y * restoredWidth + x * 2) * 4;

        const gLeft = grgbBuffer[grgbIndex];
        const r = grgbBuffer[grgbIndex + 1];
        const gRight = grgbBuffer[grgbIndex + 2];
        const b = grgbBuffer[grgbIndex + 3];

        rgbaBuffer[rgbaIndex] = r; // R
        rgbaBuffer[rgbaIndex + 1] = gLeft; // G
        rgbaBuffer[rgbaIndex + 2] = b; // B
        rgbaBuffer[rgbaIndex + 3] = 255; // A

        rgbaBuffer[rgbaIndex + 4] = r; // R
        rgbaBuffer[rgbaIndex + 5] = gRight; // G
        rgbaBuffer[rgbaIndex + 6] = b; // B
        rgbaBuffer[rgbaIndex * 7] = 255; // A
      }
    }

    this.push({
      time,
      serverStart,
      type,
      dim: [4, restoredWidth, height],
      data: rgbaBuffer,
    });

    callback();
  },
});

export function createJMLPBuffer(
  clientTime: number,
  serverStart: number,
  serverEnd: number
) {
  const buffer = Buffer.alloc(4 + 8 * 3);
  buffer.write("JMLP", 0); // chunk id
  buffer.writeDoubleBE(clientTime, 4);
  buffer.writeDoubleBE(serverStart, 12);
  buffer.writeDoubleBE(serverEnd, 20);
  return buffer;
}

export function rgbaBufferToMatrix(rgbaFrame: wrtc.nonstandard.RTCVideoFrame) {
  const { width, height, data } = rgbaFrame;

  const planecount = 4; //info.channels;
  const dim = [width, height];

  const CHUNK_ID = "JMTX";
  const header = Buffer.alloc(288);

  const type = 0; // char
  const dimstride = [planecount, planecount * dim[0]];
  const time = performance.now() / 1000; // milliseconds
  header.write(CHUNK_ID, 0, 4, "ascii"); // ID
  header.writeUInt32LE(288, 4); // Size
  header.writeUInt32BE(planecount, 8); // planecount
  header.writeUInt32BE(type, 12); // type
  header.writeUInt32BE(dim.length, 16); // dimcount
  // dim[32]
  for (let i = 0; i < 32; i++) {
    header.writeInt32BE(dim[i] || 1, 20 + i * 4);
  }
  // dimstride[32]
  for (let i = 0; i < 32; i++) {
    header.writeInt32BE(dimstride[i] || 1, 148 + i * 4);
  }
  // datasize
  header.writeUInt32BE(planecount * dim[0] * dim[1], 276);

  // time
  header.writeDoubleBE(time, 280);

  // // Chunk prefix
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(CHUNK_ID, 0, 4, "ascii");
  chunkHeader.writeUInt32LE(header.length, 4); // LE per spec

  // concat chunk, header and image
  const packet = Buffer.concat([chunkHeader, header, data]);

  return packet;
}

export function rotateRGBA(
  input: Uint8Array,
  width: number,
  height: number,
  rotation: number
): { width: number; height: number; data: Uint8Array } {
  const outWidth = rotation === 90 || rotation === 270 ? height : width;
  const outHeight = rotation === 90 || rotation === 270 ? width : height;
  const output = new Uint8Array(outWidth * outHeight * 4); // RGBA

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIndex = (y * width + x) * 4;
      let dstX = x,
        dstY = y;

      if (rotation === 90) {
        dstX = height - 1 - y;
        dstY = x;
      } else if (rotation === 180) {
        dstX = width - 1 - x;
        dstY = height - 1 - y;
      } else if (rotation === 270) {
        dstX = y;
        dstY = width - 1 - x;
      }

      const dstIndex = (dstY * outWidth + dstX) * 4;
      output[dstIndex] = input[srcIndex];
      output[dstIndex + 1] = input[srcIndex + 1];
      output[dstIndex + 2] = input[srcIndex + 2];
      output[dstIndex + 3] = input[srcIndex + 3];
    }
  }

  return {
    width: outWidth,
    height: outHeight,
    data: output,
  };
}
