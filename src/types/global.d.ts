export {};

declare global {
  interface Window {
    api: {
      pickDocx(): Promise<string | null>;
      autoParseDocx(filePath: string): Promise<
        | {
            filePath: string;
            fields: {
              key: string;
              value: string;
              source: string;
              confidence: number;
              location: string;
            }[];
          }
        | { error: string }
      >;
    };

    // Unificamos el puente aquí (coincide con preload.ts)
    ipc: {
      // DOCX
      selectDocx(): Promise<any>;
      saveDocx(bytes: Uint8Array, defaultName?: string): Promise<void>;

      // (opcionales, si los usas)
      pickRepos(): Promise<any>;
      listChanges(
        repos: { repoPath: string; repoName?: string }[],
        base?: string
      ): Promise<any>;

      // GIT
      chooseRoots(): Promise<string[]>;
      discover(roots?: string[]): Promise<string[]>;
      scan(repoPaths: string[]): Promise<import("./git").RepoStatus[]>;
      scanDiscovered(): Promise<import("./git").RepoStatus[]>;
    };

    // ⛔️ Eliminamos window.git para evitar confusión.
  }
}
