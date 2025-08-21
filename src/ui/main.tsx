// src/ui/main.tsx (ajusta la ruta si tu App está en otro lado)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css"; // ⬅️ estilos globales en v7
import App from "./App"; // o "./ui/App"
import "./index.css";

// Opcional: personaliza tu tema
const theme = createTheme({
  /* ej: colors, primaryColor, cursorType, fontFamily, headings, etc. */
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>
);
