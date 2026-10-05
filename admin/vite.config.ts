import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({ build: { rollupOptions: { input: {
  console: resolve(__dirname, "index.html"),
  phoneLogin: resolve(__dirname, "phone-login.html"),
} } } });
