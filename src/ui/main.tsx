import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./index.css";
import AppRoutes from "./routes/AppRoutes";
import { ManualProvider } from "@/context/ManualContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ManualProvider>
        <AppRoutes />
      </ManualProvider>
    </MantineProvider>
  </StrictMode>
);
