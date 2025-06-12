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

export const ayuvtoi420 = new Transform({
  writableObjectMode: true,
  readableObjectMode: true,
  async transform(chunk: ParsedBuffer, _encoding, callback) {
    const { time, serverStart, type, dim, data: ayuvBuffer } = chunk;
    const [_planecount, width, height] = dim;

    const frameSize = width * height;
    const yPlane = new Uint8Array(frameSize);
    const uPlane = new Uint8Array(frameSize >> 2);
    const vPlane = new Uint8Array(frameSize >> 2);

    let uIndex = 0;
    let vIndex = 0;

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        let uSum = 0,
          vSum = 0;

        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = x + dx;
            const py = y + dy;
            const pixelIndex = (py * width + px) * 4;
            const yIndex = py * width + px;

            yPlane[yIndex] = ayuvBuffer[pixelIndex + 1]; // Y
            uSum += ayuvBuffer[pixelIndex + 2]; // U
            vSum += ayuvBuffer[pixelIndex + 3]; // V
          }
        }

        uPlane[uIndex++] = uSum >> 2;
        vPlane[vIndex++] = vSum >> 2;
      }
    }

    const i420buffer = new Uint8Array(frameSize + (frameSize >> 1));
    i420buffer.set(yPlane, 0);
    i420buffer.set(uPlane, frameSize);
    i420buffer.set(vPlane, frameSize + (frameSize >> 2));

    this.push({
      time,
      serverStart,
      type: "i420",
      dim: [4, width, height],
      data: i420buffer,
    });

    callback();
  },
});

export const uyvytoi420 = new Transform({
  writableObjectMode: true,
  readableObjectMode: true,

  async transform(chunk: ParsedBuffer, _encoding, callback) {
    const { time, serverStart, type, dim, data: uyvyBuffer } = chunk;
    // Jitter output: [planecount=4, width/2, height]
    const [_planecount, compressedWidth, height] = dim;
    const width = compressedWidth * 2; // restore width

    const frameSize = width * height;
    const yPlane = new Uint8Array(frameSize);
    const uPlane = new Uint8Array(frameSize >> 2);
    const vPlane = new Uint8Array(frameSize >> 2);

    let uIndex = 0;
    let vIndex = 0;

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        let uSum = 0,
          vSum = 0;

        for (let dy = 0; dy < 2; dy++) {
          const py = y + dy;
          const rowStart = py * width * 2;

          for (let dx = 0; dx < 2; dx++) {
            const px = x + dx;
            const pairIndex = Math.floor(px / 2) * 4;
            const byteIndex = rowStart + pairIndex;

            const yIndex = py * width + px;

            if (px % 2 === 0) {
              yPlane[yIndex] = uyvyBuffer[byteIndex + 1];
              uSum += uyvyBuffer[byteIndex + 0];
              vSum += uyvyBuffer[byteIndex + 2];
            } else {
              yPlane[yIndex] = uyvyBuffer[byteIndex + 3];
              uSum += uyvyBuffer[byteIndex + 0];
              vSum += uyvyBuffer[byteIndex + 2];
            }
          }
        }

        uPlane[uIndex++] = uSum >> 2;
        vPlane[vIndex++] = vSum >> 2;
      }
    }

    const i420buffer = new Uint8Array(frameSize + (frameSize >> 1));
    i420buffer.set(yPlane, 0);
    i420buffer.set(uPlane, frameSize);
    i420buffer.set(vPlane, frameSize + (frameSize >> 2));

    this.push({
      time,
      serverStart,
      type: "i420",
      dim: [4, width, height],
      data: i420buffer,
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

export function bufferToMatrix(frame: wrtc.nonstandard.RTCVideoFrame) {
  const { width, height, data } = frame;

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

export function i420ToUYVYBufferWithRotation(i420: {
  width: number;
  height: number;
  data: Uint8Array;
  rotation: 0 | 90 | 180 | 270;
}): { data: Uint8Array; width: number; height: number } {
  const { width, height, data, rotation } = i420;
  const ySize = width * height;
  const uSize = ySize >> 2;

  const yPlane = data.subarray(0, ySize);
  const uPlane = data.subarray(ySize, ySize + uSize);
  const vPlane = data.subarray(ySize + uSize);

  const uyvyBuffer = new Uint8Array(width * height * 2); // 2 bytes per pixel

  let index = 0;

  for (let y = 0; y < height; y++) {
    const rowY = y * width;
    const rowUV = (y >> 1) * (width >> 1);

    for (let x = 0; x < width; x += 2) {
      const y0 = yPlane[rowY + x];
      const y1 = yPlane[rowY + x + 1];

      const uvOffset = rowUV + (x >> 1);
      const u = uPlane[uvOffset];
      const v = vPlane[uvOffset];

      uyvyBuffer[index++] = u;
      uyvyBuffer[index++] = y0;
      uyvyBuffer[index++] = v;
      uyvyBuffer[index++] = y1;
    }
  }

  // 🔄 rotation (on final buffer)
  const rotated = rotateUYVY(uyvyBuffer, width, height, rotation);

  return rotated;
}

function rotateUYVY(
  data: Uint8Array,
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270
) {
  if (rotation === 0) {
    return { data, width, height };
  }

  const pitch = width * 2;
  const newWidth = rotation === 90 || rotation === 270 ? height : width;
  const newHeight = rotation === 90 || rotation === 270 ? width : height;
  const newPitch = newWidth * 2;

  const rotated = new Uint8Array(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 2) {
      const srcOffset = y * pitch + x * 2;

      // read UYVY (4 bytes for 2 pixels)
      const u = data[srcOffset];
      const y0 = data[srcOffset + 1];
      const v = data[srcOffset + 2];
      const y1 = data[srcOffset + 3];

      // rotate position
      let dstX0, dstY0, dstX1, dstY1;

      if (rotation === 90) {
        dstX0 = height - y - 1;
        dstY0 = x;
        dstX1 = height - y - 1;
        dstY1 = x + 1;
      } else if (rotation === 180) {
        dstX0 = width - x - 2;
        dstY0 = height - y - 1;
        dstX1 = width - x - 1;
        dstY1 = height - y - 1;
      } else if (rotation === 270) {
        dstX0 = y;
        dstY0 = width - x - 2;
        dstX1 = y;
        dstY1 = width - x - 1;
      }

      // write first pixel
      let dstOffset0 = dstY0 * newPitch + dstX0 * 2;
      rotated[dstOffset0] = u;
      rotated[dstOffset0 + 1] = y0;

      // write second pixel
      let dstOffset1 = dstY1 * newPitch + dstX1 * 2;
      rotated[dstOffset1] = v;
      rotated[dstOffset1 + 1] = y1;
    }
  }

  return {
    data: rotated,
    width: newWidth,
    height: newHeight,
  };
}
