const fields = new Set(['id', 'title', 'description', 'details', 'testStrategy', 'priority', 'status', 'dependencies']);
const fail = message => { throw new Error(`DAG 校验失败：${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Task Master-style task graph. Reject bad edges rather than silently deleting them. */
export function validateDag(input) {
  if (!record(input) || Object.keys(input).some(k => k !== 'tasks') || !Array.isArray(input.tasks) || !input.tasks.length) fail('顶层必须为非空 { "tasks": [...] }');
  const ids = new Set();
  for (const task of input.tasks) {
    if (!record(task)) fail('每个任务必须是对象');
    if (Object.keys(task).some(k => !fields.has(k))) fail(`任务 ${task.id} 含未知字段`);
    if (!Number.isSafeInteger(task.id) || task.id < 1 || ids.has(task.id)) fail('id 必须为唯一正整数');
    ids.add(task.id);
  }
  const tasks = [...input.tasks].sort((a, b) => a.id - b.id).map((task, index) => {
    if (task.id !== index + 1) fail('任务 id 必须从 1 开始连续编号');
    const text = (key, required = true) => {
      const value = task[key];
      if (!required && value === undefined) return '';
      if (typeof value !== 'string' || (required && !value.trim())) fail(`任务 ${task.id} 的 ${key} 必须为非空字符串`);
      return value.trim();
    };
    const dependencies = task.dependencies;
    if (!Array.isArray(dependencies) || dependencies.some(id => !Number.isSafeInteger(id) || !ids.has(id))) fail(`任务 ${task.id} 的 dependencies 必须引用已存在的任务编号`);
    if (new Set(dependencies).size !== dependencies.length) fail(`任务 ${task.id} 存在重复依赖`);
    // Requiring topological IDs also excludes self-dependencies and cycles.
    if (dependencies.some(id => id >= task.id)) fail(`任务 ${task.id} 只能依赖编号更小的任务，不能自依赖或形成循环`);
    const priority = task.priority ?? 'medium';
    if (!['high', 'medium', 'low'].includes(priority)) fail(`任务 ${task.id} 的 priority 必须是 high/medium/low`);
    if (task.status !== undefined && task.status !== 'pending') fail(`任务 ${task.id} 的初始 status 必须是 pending`);
    return { id: task.id, title: text('title'), description: text('description'), details: text('details', false),
      testStrategy: text('testStrategy'), dependencies: [...dependencies].sort((a, b) => a - b), priority, status: 'pending' };
  });
  return { tasks };
}

export function parseDag(content) {
  let value;
  try { value = JSON.parse(content); } catch { fail('内容必须是合法 JSON，不能带 Markdown 围栏或解释文字'); }
  return validateDag(value);
}
