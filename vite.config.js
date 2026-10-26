import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  // 大学サーバー等のサブフォルダ配置でも動くよう、参照をすべて相対パスにする
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // 患者用アプリ（/）と受付端末（/terminal.html）の2画面
        main: resolve(__dirname, "index.html"),
        terminal: resolve(__dirname, "terminal.html"),
        heartFailure: resolve(__dirname, "heart-failure.html"),
        acs: resolve(__dirname, "acs.html"),
      },
    },
  },
});
