import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  // worker: {
  // format: "es",
  // },
  plugins: [
    react(),
    tailwindcss(),
    // viteSingleFile({ removeViteModuleLoader: true }),
  ],
});
