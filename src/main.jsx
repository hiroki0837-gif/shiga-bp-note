import React from "react";
import { createRoot } from "react-dom/client";
import "./base.css";
import App from "./App.jsx";

// オフラインでも開けるように（一度開いたことがあれば、圏外でも起動して記録できる）
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* 未対応環境はそのまま */ });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
