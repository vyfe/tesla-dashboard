import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // demo 模式：独立产物、独立 base，挂到后端的 /demo 前缀下对外分享。
  const demo = mode === "demo";
  return {
    base: demo ? "/demo/" : "/",
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      },
    },
    build: { outDir: demo ? "dist-demo" : "dist", sourcemap: false },
  };
});
