import { promises as fs } from "node:fs";
import { join } from "node:path";

type DiscoverOptions = {
  maxDepth?: number;
  ignoreDirs?: string[];
};

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const s = await fs.stat(join(dir, ".git"));
    if (s.isDirectory()) return true;
  } catch {}

  try {
    const s = await fs.stat(join(dir, ".git"));
    if (s.isFile()) {
      const txt = await fs.readFile(join(dir, ".git"), "utf8");
      if (txt.startsWith("gitdir:")) return true;
    }
  } catch {}

  return false;
}

export async function discoverGitRepos(
  roots: string[],
  opts: DiscoverOptions = {}
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 6;
  const ignore = new Set([
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
    ...(opts.ignoreDirs ?? []),
  ]);

  const found = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [];

  for (const r of roots) queue.push({ dir: r, depth: 0 });

  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (await isGitRepo(dir)) {
      found.add(dir);
      continue;
    }
    if (depth >= maxDepth) continue;

    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    await Promise.all(
      entries.map(async (name) => {
        if (ignore.has(name)) return;
        const full = join(dir, name);
        try {
          const st = await fs.stat(full);
          if (st.isDirectory()) queue.push({ dir: full, depth: depth + 1 });
        } catch {}
      })
    );
  }

  return Array.from(found);
}
