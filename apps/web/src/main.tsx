import "./sentry";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { watchDisplayMode } from "./utils/displayMode";
import { preconnectToApi } from "./utils/preconnect";
import { runtimeConfig } from "./api";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

// Before the first paint, so an installed app never renders a frame in which
// pinch-zoom and double-tap-zoom are still live.
watchDisplayMode();

// Ahead of the first render, so the handshake with a remote API host overlaps
// React's startup instead of delaying the dashboard's opening requests.
preconnectToApi(runtimeConfig.getApiBase());

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
