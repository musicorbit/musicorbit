import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* requests to the Fastify backend during local dev
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
