export const labels = { pending: '待执行', running: '执行中', done: '已完成', blocked: '阻塞', failed: '失败', cancelled: '已取消', paused: '已停止' };
export function isDagTransportPart(part) {
  return part?.type === 'text' && (part.metadata?.dagProgress === true || part.metadata?.dagRetry === true ||
    (['start', 'status', 'cancel'].includes(part.metadata?.dagControl?.action) && typeof part.metadata.dagControl.root === 'string'));
}
export function viewFromPart(part) {
  const view = part?.metadata?.dagView;
  if (!view) return;
  // Older progress records stored elapsed time only in their visible text.
  const elapsed = part.text?.match(/耗时 (\d+) 秒/)?.[1];
  return !view.updatedAt && elapsed && view.startedAt
    ? {...view, updatedAt: view.startedAt + Number(elapsed) * 1000} : view;
}
export function panelRows(view) {
  return (view?.tasks ?? []).map(task => ({
    title: `${task.id}. [${labels[task.status] ?? task.status}] ${task.title}`,
    value: task.id,
    description: `${task.dependencies.length ? '依赖 ' + task.dependencies.join(', ') : '无前置依赖'}${task.pr ? ' · PR #' + task.pr : ''}`,
    footer: task.error || (task.session ? '进入 Agent 会话' : '尚未创建会话'),
    task
  }));
}
