import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split lucide-react icons into their own chunk (largest dep)
          if (id.includes("lucide-react")) {
            return "icons";
          }
          // Split react vendor libs into a stable chunk
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }
          // Split react-router-dom separately
          if (id.includes("node_modules/react-router")) {
            return "vendor-router";
          }
          // Split TanStack Query into its own chunk
          if (id.includes("node_modules/@tanstack")) {
            return "vendor-query";
          }
        },
      },
    },
  },
});
