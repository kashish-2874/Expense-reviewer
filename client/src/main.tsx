import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { redirectLegacyHashUrl } from "./router";
import "./styles.css";

// Must run before the first render so the app reads the corrected URL.
redirectLegacyHashUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
