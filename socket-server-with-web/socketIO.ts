import http from "node:http";
import type { Http2SecureServer } from "node:http2";
import { Server } from "socket.io";

export default function createSocketIOServer(
  httpServer: http.Server | Http2SecureServer
) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    const { name, role, roomId, jitRecvPort } = socket.handshake.query as {
      name: string;
      role: string;
      roomId: string;
      jitRecvPort: string;
    };

    socket.on("join", async () => {
      socket.join(roomId);
      socket
        .to(roomId)
        .emit("newUser", { from: socket.id, name, role, jitRecvPort });
      console.log(`name: ${name} joined room: ${roomId}`);
    });

    socket.on("signal", ({ to, description, candidate }) => {
      socket.to(to).emit("signal", { from: socket.id, description, candidate });
    });

    socket.on("requestOffer", ({ to }) => {
      socket.to(to).emit("requestOffer", { from: socket.id });
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach((room) => {
        socket.to(room).emit("userLeft", { from: socket.id });
        console.log(`user ${socket.id} disconnecting from ${room}`);
      });
    });
  });

  return io;
}
