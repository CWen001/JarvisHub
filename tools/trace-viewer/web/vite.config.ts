import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: 5782,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5781",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
