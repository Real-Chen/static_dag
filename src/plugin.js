import { readFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseDag } from './dag.js';
import { runnerHooks } from './dag_run/plugin.js';
import { enableWorkspaces } from './runtime/local-gitea.js';

const loaded = globalThis[Symbol.for('static-dag.v2.instances')] ??= new Map();
const fileKey = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const normalize = path => path.replaceAll('\\', '/');
const loadPrompt = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').trim();
const render = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);

export default async function DagPlugin({ client, directory, worktree, serverUrl, experimental_workspace }) {
  const key = `${serverUrl?.origin ?? 'local'}|${fileKey(directory)}`;
  if (loaded.has(key)) return {};
  const root = resolve(worktree && worktree !== '/' ? worktree : directory);
  const dagPath = join(root, '.dag', 'dag.json');
  const system = loadPrompt('planner'), command = loadPrompt('command');
  const active = new Map();
  const runner = runnerHooks({ client, root, experimental_workspace });
  const toast = async (message, variant = 'info') => {
    try { await client?.tui?.showToast({ body: { title: 'DAG', message, variant } }); } catch { /* UI must not interrupt generation. */ }
  };
  async function checkTarget() {
    for (const path of [join(root, '.dag'), dagPath]) {
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`DAG 目标不能是符号链接：${path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const hooks = {
    config: async config => {
      config.command ??= {}; config.agent ??= {};
      runner.config(config);
      if (config.command.dag || config.agent['dag-planner']) throw new Error('/dag 或 dag-planner 已被其他配置占用');
      config.command.dag = { description: '分析需求并生成 .dag/dag.json（只规划）', template: '$ARGUMENTS', agent: 'dag-planner' };
      config.agent['dag-planner'] = { description: 'DAG 任务规划', mode: 'primary', hidden: true, prompt: system,
        permission: { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow',
          edit: { '*': 'deny', '.dag/dag.json': 'allow', [normalize(dagPath)]: 'allow' } } };
    },
    'command.execute.before': async (input, output) => {
      if (input.command !== 'dag') return;
      const requirement = input.arguments.trim();
      if (!requirement) throw new Error('用法：/dag 需求描述');
      active.set(input.sessionID, { pending: new Map(), saved: false });
      const attachments = output.parts.filter(p => p.type !== 'text');
      // OpenCode keeps this array by reference. Replacing output.parts is ignored.
      output.parts.splice(0, output.parts.length, { type: 'text', text: `/dag ${requirement}` }, ...attachments,
        { type: 'text', synthetic: true, text: render(command, { requirement, directory, worktree: root, dag_path: dagPath }) });
    },
    'chat.message': async input => {
      if (input.agent !== 'dag-planner') active.delete(input.sessionID);
      else if (!active.has(input.sessionID)) active.set(input.sessionID, { pending: new Map(), saved: false });
    },
    'tool.execute.before': async (input, output) => {
      await runner.before(input, output);
      const run = active.get(input.sessionID);
      if (!run) return;
      if (['read', 'glob', 'grep'].includes(input.tool)) return;
      if (input.tool !== 'write') throw new Error('DAG 规划仅允许只读探索和 write 提交目标文件');
      const path = output.args.filePath;
      if (typeof path !== 'string' || !isAbsolute(path) || fileKey(path) !== fileKey(dagPath)) throw new Error(`唯一允许写入的路径是 ${dagPath}`);
      const dag = parseDag(output.args.content);
      await checkTarget();
      output.args.filePath = dagPath;
      output.args.content = JSON.stringify(dag, null, 2) + '\n';
      run.pending.set(input.callID, JSON.stringify(dag));
    },
    'tool.execute.after': async (input, output) => {
      await runner.after(input);
      const run = active.get(input.sessionID);
      const expected = run?.pending.get(input.callID);
      if (input.tool !== 'write' || !expected) return;
      run.pending.delete(input.callID);
      const dag = parseDag(await readFile(dagPath, 'utf8'));
      if (JSON.stringify(dag) !== expected) throw new Error('DAG 写入结果与校验内容不一致，请重新提交');
      run.saved = true;
      output.title = `DAG 已生成 · ${dag.tasks.length} 个任务`;
      output.output += `\nDAG 校验及写入确认通过。任务数：${dag.tasks.length}；文件：${dagPath}`;
      output.metadata = { ...output.metadata, dagPath, taskCount: dag.tasks.length, dagValidated: true };
    },
    event: async ({ event }) => {
      await runner.event(event);
      if (!['session.idle', 'session.error', 'session.deleted'].includes(event.type)) return;
      const sessionID = event.properties?.sessionID ?? event.properties?.info?.id;
      const run = active.get(sessionID);
      if (!run) return;
      active.delete(sessionID);
      if (!run.saved && event.type === 'session.idle') await toast('本轮未成功写入有效 DAG，请查看 Agent 输出；旧文件不代表本轮完成。', 'warning');
    },
    tool: runner.tool,
    dispose: async () => { active.clear(); await runner.dispose(); if (loaded.get(key) === hooks) loaded.delete(key); }
  };
  if (process.platform === 'win32') await enableWorkspaces().catch(() => {});
  loaded.set(key, hooks);
  return hooks;
}
