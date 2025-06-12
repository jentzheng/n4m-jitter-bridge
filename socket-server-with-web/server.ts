import http from "node:http";
import express from "express";
import { createServer as createViteServer } from "vite";
import createSocketIOServer from "./socketIO";

const app = express();
const server = http.createServer(app);

createSocketIOServer(server);

const isDev = process.env.NODE_ENV !== "production";
if (isDev) {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static("dist"));
}

app.use(express.static("public"));

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Closing server...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
