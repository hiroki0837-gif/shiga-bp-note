import React from "react";
import { createRoot } from "react-dom/client";
import "./base.css";
import HeartFailure from "./HeartFailure.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HeartFailure />
  </React.StrictMode>
);
