import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/client/app";
import { AuthProvider } from "@/client/auth";
import { ToastProvider } from "@/client/toast";
import "@/client/styles/app.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element #root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
