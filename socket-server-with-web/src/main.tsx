import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";

import App from "./App.tsx";
import "./index.css";
import { CameraRoute } from "./CameraRoute.tsx";
import { DetectionRoute } from "./DetectionRoute.tsx";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    // <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<DetectionRoute />} />
          <Route path="camera" element={<CameraRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
    // </StrictMode>
  );
}
