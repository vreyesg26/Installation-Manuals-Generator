export {};
declare global {
  interface Window {
    ipc: {
      selectDocx: () => Promise<{ filePath: string; base64: string } | null>;
      pickRepos: () => Promise<{ repoName: string; repoPath: string }[]>;
      listChanges: (
        repos: { repoPath: string; repoName?: string }[],
        base?: string
      ) => Promise<import("@/types/manual").RepoChanges[]>;
      selectDocx: () => Promise<{ filePath: string; buffer: ArrayBufferLike } | null>;
      saveDocx: (bytes: Uint8Array, defaultName?: string) => Promise<{ saved: boolean; filePath: string } | null>;
    };
  }
}
