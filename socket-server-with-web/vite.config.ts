import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import basicSsl from "@vitejs/plugin-basic-ssl";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  server: {
    host: true,
    // https: {
    //   key: fs.readFileSync(path.resolve(__dirname, "certs/localhost-key.pem")),
    //   cert: fs.readFileSync(
    //     path.resolve(__dirname, "certs/localhost-cert.pem")
    //   ),
    // },
    allowedHosts: [".trycloudflare.com"],
  },
  build: {},
  plugins: [
    react(),
    tailwindcss(),
    // basicSsl(),
    // viteSingleFile({ removeViteModuleLoader: true }),
  ],
});
