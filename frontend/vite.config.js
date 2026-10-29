import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// npm run dev  → http://localhost:5173 con proxy de /api hacia FastAPI (mismo origen: la cookie HttpOnly funciona)
// npm run build → dist/  (para servirlo desde FastAPI: FRONTEND_DIR=../frontend/dist en backend/.env)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __UNISMART_MODE__: JSON.stringify(process.env.UNISMART_MODE || "auto"),
    __UNISMART_API__: JSON.stringify(process.env.UNISMART_API || ""),
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
});
