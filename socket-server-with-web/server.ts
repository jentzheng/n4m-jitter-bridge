import { Server } from "socket.io";
import http from "node:http";
import express from "express";
import { createServer as createViteServer } from "vite";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://admin.socket.io", "http://localhost:8080"],
    credentials: true,
  },
});

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: {
      server,
    },
  },
  appType: "spa",
});

app.use(vite.middlewares);

app.use(express.static("static"));

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

server.listen(8080, () => {
  console.log(`Example app listening at http://localhost:8080`);
});
