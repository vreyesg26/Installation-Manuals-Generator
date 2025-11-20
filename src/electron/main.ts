// electron/main.ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import type { SimpleGit, StatusResult } from "simple-git";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev =
  !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";

/** Resuelve y loguea la ruta del preload compilado */
function getPreloadPath() {
  const p = path.join(__dirname, "preload.js");
  return p;
}

/** Busca un index.html válido para producción (ajústalo si tu build es distinto) */
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

// -------------------- Helpers varios que ya tenías (opcionales) --------------------
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

// -------------------- Ventana --------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    title: '',
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

// -------------------- Descubrimiento & Scan de repos (AUTOMÁTICO) --------------------
let CACHED_ROOTS: string[] = [];
let CACHED_REPOS: string[] = [];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "dist",
  "out",
  ".next",
  ".cache",
  ".turbo",
]);

async function isGitRepo(dir: string) {
  try {
    const st = await fsp.stat(path.join(dir, ".git"));
    if (st.isDirectory()) return true; // repo normal
    if (st.isFile()) {
      const txt = await fsp.readFile(path.join(dir, ".git"), "utf8");
      if (txt.startsWith("gitdir:")) return true; // worktree/submódulo
    }
  } catch {}
  return false;
}

async function discoverGitRepos(roots: string[], maxDepth = 12) {
  const found = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = roots.map((r) => ({
    dir: r,
    depth: 0,
  }));

  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (await isGitRepo(dir)) {
      found.add(dir);
      continue; // no profundizar dentro de un repo para evitar costo
    }
    if (depth >= maxDepth) continue;

    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }

    await Promise.all(
      names.map(async (name) => {
        if (IGNORE_DIRS.has(name)) return;
        const full = path.join(dir, name);
        try {
          const st = await fsp.stat(full);
          if (st.isDirectory()) queue.push({ dir: full, depth: depth + 1 });
        } catch {}
      })
    );
  }

  return Array.from(found);
}

type RepoChange = {
  path: string;
  worktree: string;
  index: string;
  renameFrom?: string;
  conflicted?: boolean;
  ext?: string;
  kind:
    | "modified"
    | "added"
    | "deleted"
    | "untracked"
    | "renamed"
    | "copied"
    | "unknown";
};

type RepoStatus = {
  repoPath: string;
  repoName: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  changes: RepoChange[];
};

function kindFromXY(X: string, Y: string): RepoChange["kind"] {
  if (X === "A" || Y === "A") return "added";
  if (X === "D" || Y === "D") return "deleted";
  if (X === "M" || Y === "M") return "modified";
  return "unknown";
}

async function scanReposSimple(repoPaths: string[]): Promise<RepoStatus[]> {
  const out: RepoStatus[] = [];
  for (const repoPath of repoPaths) {
    try {
      const git: SimpleGit = simpleGit({ baseDir: repoPath });
      const st: StatusResult = await git.status();
      const conflictedSet = new Set<string>(st.conflicted ?? []);
      out.push({
        repoPath,
        repoName: path.basename(repoPath),
        branch: st.current || undefined,
        ahead: st.ahead ?? 0,
        behind: st.behind ?? 0,
        changes: st.files.map((f: StatusResult["files"][number]) => ({
          path: f.path,
          worktree: f.working_dir || " ",
          index: f.index || " ",
          conflicted: conflictedSet.has(f.path),
          ext: path.extname(f.path) || undefined,
          kind: kindFromXY(f.index || " ", f.working_dir || " "),
        })),
      });
    } catch (err) {
      console.warn("[GIT] scan error en", repoPath, err);
      out.push({
        repoPath,
        repoName: path.basename(repoPath),
        branch: undefined,
        ahead: 0,
        behind: 0,
        changes: [],
      });
    }
  }
  return out;
}

// === Handlers GIT (idempotentes) ===
function registerGitIpcHandlers() {
  // Limpia handlers previos (útil con hot reload en dev)
  ipcMain.removeHandler("git:choose-roots");
  ipcMain.removeHandler("git:discover");
  ipcMain.removeHandler("git:scan");
  ipcMain.removeHandler("git:scan-discovered");

  ipcMain.handle("git:choose-roots", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Selecciona carpetas raíz para descubrir repos",
      properties: ["openDirectory", "multiSelections", "dontAddToRecent"],
    });
    if (canceled) return [];
    CACHED_ROOTS = filePaths;
    return CACHED_ROOTS;
  });

  ipcMain.handle("git:discover", async (_evt, roots?: string[]) => {
    const useRoots = roots && roots.length ? roots : CACHED_ROOTS;
    if (!useRoots?.length) return [];

    CACHED_REPOS = await discoverGitRepos(useRoots, 12); // profundidad ↑
    return CACHED_REPOS;
  });

  ipcMain.handle("git:scan", async (_evt, repoPaths: string[]) => {
    const count = Array.isArray(repoPaths) ? repoPaths.length : 0;
    if (!Array.isArray(repoPaths) || count === 0) return [];
    const res = await scanReposSimple(repoPaths);
    return res;
  });

  ipcMain.handle("git:scan-discovered", async () => {
    if (!CACHED_REPOS.length) return [];
    return await scanReposSimple(CACHED_REPOS);
  });
}

// -------------------- IPCs DOCX --------------------
function registerDocxIpcHandlers() {
  ipcMain.removeHandler("select-docx");
  ipcMain.removeHandler("save-docx");

  ipcMain.handle("select-docx", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: "Word", extensions: ["docx"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths[0]) return null;

    const filePath = filePaths[0];
    const nodeBuf = await fsp.readFile(filePath);
    const bytes = new Uint8Array(
      nodeBuf.buffer,
      nodeBuf.byteOffset,
      nodeBuf.byteLength
    );
    return { filePath, bytes };
  });

  ipcMain.handle(
    "save-docx",
    async (_evt, args: { bytes: Uint8Array; defaultName?: string }) => {
      const { bytes, defaultName = "Manual-actualizado.docx" } = args ?? {};
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: "Word", extensions: ["docx"] }],
      });
      if (canceled || !filePath) return null;
      await fsp.writeFile(filePath, Buffer.from(bytes));
      return { saved: true, filePath };
    }
  );
}

// -------------------- IPC: seleccionar repos manualmente (lo mantenemos) --------------------
function registerPickReposHandler() {
  ipcMain.removeHandler("git:pick-repos");
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
}

// -------------------- App lifecycle --------------------
app.whenReady().then(() => {
  // Registra handlers de forma idempotente (evita duplicados en HMR)
  registerDocxIpcHandlers();
  registerPickReposHandler();
  registerGitIpcHandlers();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
