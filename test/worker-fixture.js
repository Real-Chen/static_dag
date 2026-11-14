// Independent fixture parser for the human-readable worker message.
export function parseWorkerInput(text) {
  const header = text.match(/^任务 (\d+)：(.+)$/m);
  const worktree = text.match(/^工作目录：(.+)$/m);
  if (!header || !worktree) throw new Error('Missing readable task input');
  if (/"(?:workspaceID|session|integrationRef|cloneUrl|baseCommit)"\s*:/.test(text)) throw new Error('Runtime state leaked into model input');
  return {id: Number(header[1]), title: header[2], worktree: worktree[1]};
}
