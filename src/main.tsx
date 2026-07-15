import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

window.addEventListener("error", (event) => {
  console.error("[boot:error]", event.message, {
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[boot:unhandledrejection]", event.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
