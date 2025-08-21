// electron/main.ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import simpleGit from "simple-git";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev =
  !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";

function getPreloadPath() {
  const p = path.join(__dirname, "preload.js");
  console.log("[Electron] preload path:", p, "exists:", fs.existsSync(p));
  return p;
}

function getProdIndexFile() {
  const candidates = [
    path.join(process.cwd(), "dist", "index.html"),
    path.join(__dirname, "../dist", "index.html"),
    path.join(__dirname, "../renderer", "index.html"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  console.error("[Electron] No encontré index.html en:", candidates);
  return null;
}

function extToTipo(ext: string) {
  const e = ext.toLowerCase();
  if (e === "jar") return "JAR";
  if (e === "sql") return "Script SQL";
  if (e === "sp" || e === "spsql") return "Stored Procedure";
  if (e === "dtsx") return "SSIS Package";
  if (e === "pks" || e === "pkb" || e === "pkg") return "Oracle Package";
  if (e === "tps") return "Oracle Type";
  if (e === "xqy" || e === "xquery") return "XQuery";
  if (e === "wsdl") return "WSDL";
  if (e === "xsd") return "XSD";
  if (e === "yaml" || e === "yml") return "YAML";
  if (e === "json") return "JSON";
  if (e === "dll") return "DLL";
  if (e === "war" || e === "ear") return e.toUpperCase();
  if (e === "xml" || e === "js" || e === "ts") return e.toUpperCase();
  return e.toUpperCase();
}

function mapStatus(
  code: string
): "Nuevo" | "Modificado" | "Renombrado" | "Eliminado" | "Desconocido" {
  if (code.includes("A")) return "Nuevo";
  if (code.includes("M")) return "Modificado";
  if (code.includes("R")) return "Renombrado";
  if (code.includes("D")) return "Eliminado";
  return "Desconocido";
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5123";
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexFile = getProdIndexFile();
    if (indexFile) {
      win.loadFile(indexFile);
    } else {
      win.loadURL(
        "data:text/plain,No se encontró el index.html del renderer. Ejecuta 'vite build'."
      );
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPCs ---

// --- IPC: abrir .docx ---
ipcMain.handle("select-docx", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: "Word", extensions: ["docx"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return null;

  const filePath = filePaths[0];
  const nodeBuf = await fsp.readFile(filePath);
  const bytes = new Uint8Array(nodeBuf.buffer, nodeBuf.byteOffset, nodeBuf.byteLength);
  return { filePath, bytes };
});

// --- IPC: guardar .docx ---
ipcMain.handle("save-docx", async (_evt, args: { bytes: Uint8Array; defaultName?: string }) => {
  const { bytes, defaultName = "Manual-actualizado.docx" } = args ?? {};
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: "Word", extensions: ["docx"] }],
  });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, Buffer.from(bytes));
  return { saved: true, filePath };
});


// Seleccionar uno o varios repos
ipcMain.handle("git:pick-repos", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Selecciona repositorios (carpetas con .git)",
    properties: ["openDirectory", "multiSelections", "createDirectory"],
  });
  if (canceled) return [];
  return filePaths
    .filter((p) => existsSync(path.join(p, ".git")))
    .map((p) => ({
      repoName: path.basename(p),
      repoPath: p,
    }));
});


