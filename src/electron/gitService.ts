import { execFile } from "node:child_process";
import { basename, extname } from "node:path";

export type RepoChange = {
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

export type RepoStatus = {
  repoPath: string;
  repoName: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  changes: RepoChange[];
};

function execGit(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(Buffer.from(stdout, "utf8"));
      }
    );
  });
}

function makeChange(path: string, X: string, Y: string): RepoChange {
  const kind: RepoChange["kind"] =
    X === "A" || Y === "A"
      ? "added"
      : X === "D" || Y === "D"
      ? "deleted"
      : X === "M" || Y === "M"
      ? "modified"
      : "unknown";
  return {
    path,
    worktree: Y,
    index: X,
    kind,
    conflicted: false,
    ext: extname(path) || undefined,
  };
}

function parseStatusPorcelain(output: Buffer) {
  const SEP = "\0";
  const text = output.toString("utf8");
  const items = text.split(SEP);
  const changes: RepoChange[] = [];
  let branch: string | undefined;
  let ahead = 0;
  let behind = 0;

  for (const line of items) {
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.startsWith("# branch.head ")) branch = line.slice(14).trim();
      if (line.startsWith("# branch.ab ")) {
        const a = /\+(\d+)/.exec(line);
        const b = /-(\d+)/.exec(line);
        ahead = a ? Number(a[1]) : 0;
        behind = b ? Number(b[1]) : 0;
      }
      continue;
    }
    const code = line[0];
    if (code === "1" || code === "2") {
      const parts = line.split(" ");
      const xy = parts[1];
      const X = xy[0];
      const Y = xy[1];
      if (code === "1") {
        const path = parts[parts.length - 1];
        changes.push(makeChange(path, X, Y));
      } else {
        const path = parts[parts.length - 1];
        const from = parts[parts.length - 2];
        const ch = makeChange(path, X, Y);
        ch.renameFrom = from;
        ch.kind = xy.includes("R")
          ? "renamed"
          : xy.includes("C")
          ? "copied"
          : ch.kind;
        changes.push(ch);
      }
    } else if (code === "?") {
      const path = line.substring(2);
      changes.push({
        path,
        worktree: "?",
        index: " ",
        kind: "untracked",
        conflicted: false,
        ext: extname(path) || undefined,
      });
    } else if (code === "u") {
      const parts = line.split(" ");
      const path = parts[parts.length - 1];
      changes.push({
        path,
        worktree: "U",
        index: "U",
        kind: "modified",
        conflicted: true,
        ext: extname(path) || undefined,
      });
    }
  }
  return { branch, ahead, behind, changes };
}

async function statusForRepo(repoPath: string): Promise<RepoStatus> {
  const out = await execGit(
    ["status", "--porcelain=v2", "-z", "--branch"],
    repoPath
  );
  const { branch, ahead, behind, changes } = parseStatusPorcelain(out);
  return {
    repoPath,
    repoName: basename(repoPath),
    branch,
    ahead,
    behind,
    changes,
  };
}

export async function scanRepos(repoPaths: string[]): Promise<RepoStatus[]> {
  const tasks = repoPaths.map(async (p) => {
    try {
      return await statusForRepo(p);
    } catch {
      return {
        repoPath: p,
        repoName: p.split(/[\\/]/).pop() || p,
        branch: undefined,
        ahead: 0,
        behind: 0,
        changes: [],
      } as RepoStatus;
    }
  });
  return Promise.all(tasks);
}
