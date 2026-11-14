import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export async function git(cwd, args, signal) {
  const result = await promisify(execFile)('git', args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, signal });
  return result.stdout.trim();
}
export async function clean(cwd) {
  if (await git(cwd, ['status', '--porcelain', '--untracked-files=all'])) throw new Error(`工作区有未提交文件，请先提交：${cwd}`);
}
