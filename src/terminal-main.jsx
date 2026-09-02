import React from "react";
import { createRoot } from "react-dom/client";
import "./base.css";
import Terminal from "./Terminal.jsx";

// 受付端末も圏外で開けるように
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* 未対応環境はそのまま */ });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Terminal />
  </React.StrictMode>
);
