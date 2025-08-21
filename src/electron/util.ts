import { execFile } from 'node:child_process';

export function execGit(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(Buffer.from(stdout, 'utf8'));
    });
  });
}

export function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}