export type RepoChange = {
  path: string; // ruta relativa en el repo
  worktree: string; // estado en working tree: M/A/D/?
  index: string; // estado en índice: M/A/D/␣
  renameFrom?: string; // ruta anterior si es rename
  conflicted?: boolean; // true si hay conflicto
  ext?: string; // extensión del archivo (derivada)
  kind:
    | "modified"
    | "added"
    | "deleted"
    | "untracked"
    | "renamed"
    | "copied"
    | "unknown";
};

export type RepoStatus = {
  repoPath: string;
  repoName: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  changes: RepoChange[];
};
