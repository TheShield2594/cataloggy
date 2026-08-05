import "./sentry";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { watchDisplayMode } from "./utils/displayMode";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

// Before the first paint, so an installed app never renders a frame in which
// pinch-zoom and double-tap-zoom are still live.
watchDisplayMode();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <UpdatePrompt />
    </ErrorBoundary>
  </React.StrictMode>
);
