import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DagRun, DEFAULT_MAX_CONCURRENCY} from '../src/dag_run/index.js';

const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
function fixture(dependencies, maxConcurrency = DEFAULT_MAX_CONCURRENCY) {
  const run = new DagRun();
  Object.assign(run, {config: {maxConcurrency}, controller: new AbortController(),
    state: {status: 'running', tasks: dependencies.map((deps, i) => ({id: i + 1, dependencies: deps, status: 'pending'}))},
    async initializeIntegration() {}, async save() {}, async release() {this.released = true;}});
  return run;
}

test('同前置节点的两个分支并发，空闲名额立即启动后续节点，汇合等待全部前置', {timeout: 3000}, async () => {
  const run = fixture([[], [1], [1], [2], [3, 4], [5]], 2), starts = [], ends = [];
  const bothStarted = deferred(), finishThird = deferred();
  let live = 0, peak = 0;
  run.runTask = async task => {
    starts.push(task.id); live++; peak = Math.max(peak, live);
    if (task.id === 2) await bothStarted.promise;
    if (task.id === 3) {bothStarted.resolve(); await finishThird.promise;}
    if (task.id === 4) {assert.ok(!ends.includes(3), '任务 4 不应等无依赖的任务 3'); finishThird.resolve();}
    if (task.id === 5) assert.ok(ends.includes(3) && ends.includes(4));
    task.status = 'done'; ends.push(task.id); live--;
  };
  await run.execute();
  assert.equal(run.state.status, 'done'); assert.equal(peak, 2);
  assert.deepEqual(starts, [1, 2, 3, 4, 5, 6]); assert.equal(run.released, true);
});

test('PR 合并后仍等待 Agent 最终回复结束，才允许依赖节点启动和 Fork', {timeout: 3000}, async () => {
  const run = fixture([[], [1], [1], [2]]), merged = deferred(), finishAgent = deferred(), checked = deferred();
  let successorStarted = false;
  run.runTask = async task => {
    if (task.id === 2) {task.status = 'done'; merged.resolve(); await finishAgent.promise;}
    if (task.id === 3) {await merged.promise; checked.resolve();}
    if (task.id === 4) successorStarted = true;
    task.status = 'done';
  };
  const executing = run.execute();
  await checked.promise; await new Promise(resolve => setImmediate(resolve));
  assert.equal(successorStarted, false);
  finishAgent.resolve(); await executing; assert.equal(successorStarted, true);
});

test('一个分支失败会终止所有活动分支，等待收尾后释放锁，不启动汇合', {timeout: 3000}, async () => {
  const run = fixture([[], [], [1, 2]]), siblingStarted = deferred();
  let siblingStopped = false, successorStarted = false;
  run.runTask = async (task, context) => {
    if (task.id === 1) {await siblingStarted.promise; task.status = 'failed'; throw new Error('test failure');}
    if (task.id === 2) {
      siblingStarted.resolve();
      await new Promise(resolve => context.abort.addEventListener('abort', resolve, {once: true}));
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(!run.released); siblingStopped = true; task.status = 'cancelled';
    }
    if (task.id === 3) successorStarted = true;
  };
  await run.execute();
  assert.equal(run.state.status, 'failed'); assert.equal(siblingStopped, true);
  assert.equal(successorStarted, false); assert.equal(run.state.tasks[2].status, 'blocked'); assert.equal(run.released, true);
});

test('maxConcurrency=1 保持串行；共享集成队列一次只执行一项', {timeout: 3000}, async () => {
  const run = fixture([[], [], []], 1), events = [];
  run.runTask = async task => {events.push(`start${task.id}`); await new Promise(resolve => setImmediate(resolve)); task.status = 'done'; events.push(`end${task.id}`);};
  await run.execute();
  assert.deepEqual(events, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  let live = 0, peak = 0;
  await Promise.all([1, 2, 3].map(() => run.integrate(async () => {live++; peak = Math.max(peak, live); await new Promise(resolve => setImmediate(resolve)); live--;})));
  assert.equal(peak, 1);
});

test('真实节点准备失败时立即取消兄弟任务，不等待状态文件写完', {timeout: 3000}, async () => {
  const run = fixture([[]]), saveFinished = deferred(), aborted = deferred();
  run.assertLocal = async () => {throw new Error('prepare failed');};
  run.save = () => saveFinished.promise;
  run.state.tasks[0].status = 'running';
  run.controller.signal.addEventListener('abort', aborted.resolve, {once: true});
  const outcome = run.runTask(run.state.tasks[0], {abort: run.controller.signal, metadata() {}})
    .then(() => null, error => error);
  await aborted.promise;
  assert.equal(run.state.tasks[0].status, 'failed');
  assert.equal(run.failure.message, 'prepare failed');
  saveFinished.resolve();
  assert.equal((await outcome).message, 'prepare failed');
});

test('默认上限 20：同时启动 20 个就绪节点，第 21 个等待空位', {timeout: 3000}, async () => {
  assert.equal(DEFAULT_MAX_CONCURRENCY, 20);
  const run = fixture(Array.from({length: 21}, () => []));
  const gates = Array.from({length: 21}, deferred), firstTwenty = deferred(), twentyFirst = deferred();
  let starts = 0, live = 0, peak = 0;
  run.runTask = async task => {
    starts++; live++; peak = Math.max(peak, live);
    if (starts === 20) firstTwenty.resolve();
    if (task.id === 21) twentyFirst.resolve();
    await gates[task.id - 1].promise;
    task.status = 'done'; live--;
  };
  const executing = run.execute();
  await firstTwenty.promise;
  assert.equal(starts, 20); assert.equal(run.state.tasks[20].status, 'pending');
  gates[0].resolve();
  await twentyFirst.promise;
  assert.equal(peak, 20);
  for (const gate of gates) gate.resolve();
  await executing; assert.equal(run.state.status, 'done');
});
