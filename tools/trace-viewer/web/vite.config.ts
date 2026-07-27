import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.TRACE_VIEWER_API_BASE || "http://127.0.0.1:5781";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: 5782,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
