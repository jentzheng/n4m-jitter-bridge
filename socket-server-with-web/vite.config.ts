import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import CreateSocketIOServer from "./socketIO";

function socketIOPlugin(): Plugin {
  return {
    name: "socket-io",
    configureServer(server) {
      if (!server.httpServer) return;
      CreateSocketIOServer(server.httpServer);
    },
    configurePreviewServer(server) {
      if (!server.httpServer) return;
      CreateSocketIOServer(server.httpServer);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
  },
  plugins: [
    react(),
    tailwindcss(),
    socketIOPlugin(),
    process.env.SELF_SIGN_SSL === "true" && basicSsl(),
  ],
});
