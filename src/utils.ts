import { Transform, TransformCallback } from "node:stream";
import sharp from "sharp";

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

export const grgbtorgb = new Transform({
  writableObjectMode: true,
  readableObjectMode: true,
  async transform(chunk: ParsedBuffer, _encoding, callback) {
    const { time, serverStart, type, dim, data: grgbBuffer } = chunk;
    const [_planecount, width, height] = dim;

    const restoredWidth = width * 2;
    const rgbBuffer = Buffer.alloc(restoredWidth * height * 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const grgbIndex = (y * width + x) * 4;
        const rgbIndex = (y * restoredWidth + x * 2) * 3;

        const gLeft = grgbBuffer[grgbIndex];
        const r = grgbBuffer[grgbIndex + 1];
        const gRight = grgbBuffer[grgbIndex + 2];
        const b = grgbBuffer[grgbIndex + 3];

        rgbBuffer[rgbIndex] = r; // R
        rgbBuffer[rgbIndex + 1] = gLeft; // G
        rgbBuffer[rgbIndex + 2] = b; // B

        rgbBuffer[rgbIndex + 3] = r; // R
        rgbBuffer[rgbIndex + 4] = gRight; // G
        rgbBuffer[rgbIndex + 5] = b; // B
      }
    }

    const jpeg = await sharp(rgbBuffer, {
      raw: {
        width: restoredWidth,
        height: height,
        channels: 3,
      },
    })
      .jpeg({
        quality: 30,
      })
      .toBuffer();

    this.push({
      time,
      serverStart,
      type,
      dim: [3, restoredWidth, height],
      data: jpeg,
    });

    callback();
  },
});

export class FrameChunkEncoder extends Transform {
  private chunkSize: number;
  private frameCounter: number = 0;

  constructor(chunkSize = 65536) {
    super({
      // readableObjectMode: true,
      writableObjectMode: true,
    });
    this.chunkSize = chunkSize;
  }

  _transform(
    chunk: ParsedBuffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const frameId = this.frameCounter++ % 0xffffffff;
    const { data, dim } = chunk;
    const planecount = dim[0];
    const width = dim[1];
    const height = dim[2];
    const totalChunks = Math.ceil(data.length / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const headerBuffer = new Uint8Array(20);
      const view = new DataView(headerBuffer.buffer);
      view.setUint32(0, frameId, true); // frameId
      view.setUint16(4, i, true); // chunkIndex
      view.setUint16(6, totalChunks, true); // totalChunks
      view.setUint32(8, data.length, true); // total frame size
      view.setUint8(12, planecount); // planecount
      view.setUint16(13, width, true); // width
      view.setUint16(15, height, true); // height
      view.setUint8(17, 0); // reserved
      view.setUint8(18, 0);
      view.setUint8(19, 0);

      const chunkData = data.subarray(
        i * this.chunkSize,
        Math.min((i + 1) * this.chunkSize, data.length)
      );

      const packet = new Uint8Array(headerBuffer.length + chunkData.length);
      packet.set(headerBuffer, 0);
      packet.set(chunkData, headerBuffer.length);

      this.push(packet);
    }

    callback();
  }
}

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

export async function jpegBufferToMatrix(buffer: ArrayBuffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({
    resolveWithObject: true,
  });

  const planecount = info.channels;
  const dim = [info.width, info.height];

  // const typeMap = new Map<typeof typeStr, number>([
  //   ["char", 0],
  //   ["long", 1],
  //   ["float32", 2],
  //   ["float64", 3],
  // ]);
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
