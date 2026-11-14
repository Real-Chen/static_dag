import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskInput} from '../src/dag_run/input.js';

const task = {id: 3, title: '实现 greeting', description: '导出 greet(name)', details: '使用 ES module',
  testStrategy: '测试 greet("DAG") 的返回值', worktree: 'D:/work/task-3', dependencies: [1, 2],
  status: 'running', session: 'internal-session', workspaceID: 'internal-workspace', branch: 'internal-branch',
  baseCommit: 'internal-commit', gitea: {cloneUrl: 'internal-clone-url'}};

test('开发输入只传任务和当前目录，不序列化调度状态或重复路径', () => {
  const input = taskInput(task);
  assert.match(input, /任务 3：实现 greeting/);
  for (const field of ['导出 greet(name)', '使用 ES module', '测试 greet("DAG") 的返回值']) assert.ok(input.includes(field));
  assert.equal(input.split(task.worktree).length - 1, 1);
  assert.doesNotMatch(input, /internal-|workspaceID|baseCommit|cloneUrl|"status"/);
  assert.ok(!input.trim().startsWith('{'));
});

test('Fork 不重复注入前置报告，汇合新会话保留直接依赖结果', () => {
  const predecessors = [{id: 1, title: 'API', report: 'API 已测试', commit: 'internal-one'},
    {id: 2, title: 'UI', report: 'UI 已测试', pr: 123}];
  const fork = taskInput(task, [predecessors[0]], true);
  assert.doesNotMatch(fork, /API 已测试|前置任务结果/);
  const join = taskInput(task, predecessors);
  assert.match(join, /任务 1：API\nAPI 已测试/); assert.match(join, /任务 2：UI\nUI 已测试/);
  assert.doesNotMatch(join, /internal-one|123/);
});
