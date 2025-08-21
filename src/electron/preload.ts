import { contextBridge, ipcRenderer } from "electron";

// Exponemos TODO bajo window.ipc (unificado)
contextBridge.exposeInMainWorld("ipc", {
  // DOCX (lo que ya tenías)
  selectDocx: () => ipcRenderer.invoke("select-docx"),
  saveDocx: (bytes: Uint8Array, defaultName?: string) =>
    ipcRenderer.invoke("save-docx", { bytes, defaultName }),

  // (si usas estos en otro lado, los dejamos)
  pickRepos: () => ipcRenderer.invoke("git:pick-repos"),
  listChanges: (
    repos: { repoPath: string; repoName?: string }[],
    base?: string
  ) => ipcRenderer.invoke("git:list-changes", { repos, base }),

  // --- GIT: descubrimiento y escaneo ---
  chooseRoots: (): Promise<string[]> => ipcRenderer.invoke("git:choose-roots"),
  discover: (roots?: string[]): Promise<string[]> =>
    ipcRenderer.invoke("git:discover", roots),
  scan: (repoPaths: string[]) => ipcRenderer.invoke("git:scan", repoPaths),
  scanDiscovered: () => ipcRenderer.invoke("git:scan-discovered"),
});
