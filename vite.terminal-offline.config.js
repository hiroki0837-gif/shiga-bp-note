// 受付端末のオフライン単一HTML版を作るための設定。
// 使い方: npx vite build --config vite.terminal-offline.config.js
//   → dist-terminal-offline/ に terminal.html と assets が出る。
//   その後 scripts/make_terminal_offline.py がJS/CSSをHTMLに埋め込み、1ファイルに固める。
// 受付PCにそのファイルを置いてダブルクリックで開く運用（サーバー・ネット不要）。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-terminal-offline",
    rollupOptions: {
      input: resolve(__dirname, "terminal.html"),
      output: {
        // チャンク分割をやめて1つのJSにまとめる（HTMLへ埋め込むため）
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
