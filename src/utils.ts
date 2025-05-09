export function grgb2rgb(grgbBuffer: Buffer, width: number, height: number) {
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

  return { rgbBuffer, originalWidth: restoredWidth, originalHeight: height };
}

export function parseMatrixHeader(buffer: Buffer<ArrayBuffer>) {
  const typeMap = new Map<number, string>([
    [0, "char"],
    [1, "long"],
    [2, "float32"],
    [3, "float64"],
  ]);

  return {
    id: buffer.subarray(0, 4).reverse().toString(),
    size: buffer.readInt32BE(4),
    planecount: buffer.readInt32BE(8),
    type: typeMap.get(buffer.readInt32BE(12)),
    dimcount: buffer.readInt32BE(16),
    dim: Array.from({ length: 32 }, (_, i) => buffer.readInt32BE(20 + i * 4)),
    dimstride: Array.from({ length: 32 }, (_, i) =>
      buffer.readInt32BE(148 + i * 4)
    ),
    datasize: buffer.readInt32BE(276),
    time: buffer.readDoubleBE(280),
  };
}

export function matrixToBuffer(buffer: Buffer<ArrayBuffer>) {
  const HEADER_SIZE = 288; // Size of the matrix header, excluding the chunk header

  if (buffer.length < HEADER_SIZE + 8) {
    return null; // not enough data
  }

  const chunkId = buffer.subarray(0, 4).toString();
  if (chunkId !== "JMTX") {
    console.log(`Unknown chunk ID: ${chunkId}. Waiting for more data...`);
    return null;
  }

  const matrixHeader = parseMatrixHeader(buffer.subarray(8, HEADER_SIZE + 8));
  // console.log("Matrix Header:", matrixHeader);

  const totalSize = HEADER_SIZE + 8 + matrixHeader.datasize;
  if (buffer.length < totalSize) {
    return null; // not enough data
  }

  const data = buffer.subarray(HEADER_SIZE + 8, totalSize);

  return {
    type: matrixHeader.type,
    width: matrixHeader.dim[0],
    height: matrixHeader.dim[1],
    planecount: matrixHeader.planecount,
    time: matrixHeader.time,
    data,
  };
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
