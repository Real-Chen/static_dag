import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DagRun} from '../src/dag_run/index.js';
import {ModelGate, rateLimit, retryDelay} from '../src/dag_run/rate-limit.js';
import {isDagTransportPart} from '../src/dag_run/panel-model.js';

const limited = headers => ({name: 'APIError', data: {statusCode: 429, isRetryable: true, responseHeaders: headers}});
test('429 结构识别与 Retry-After 秒数、日期、毫秒、无头退避', () => {
  assert.ok(rateLimit(new Error(JSON.stringify(limited({})))));
  assert.ok(rateLimit(new Error('SDK failure', {cause: limited({})})));
  assert.equal(rateLimit(new Error(JSON.stringify({data: {statusCode: 401}}))), undefined);
  assert.equal(rateLimit(new Error('业务校验失败，任务编号 429')), undefined);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryDelay({'Retry-After': '60'}, 1, now), 60000);
  assert.equal(retryDelay({'retry-after': 'Thu, 01 Jan 2026 00:02:00 GMT'}, 1, now), 120000);
  assert.equal(retryDelay({'retry-after-ms': '500'}, 1, now), 500);
  assert.equal(retryDelay({}, 1, now, 0), 2000);
  assert.equal(retryDelay({}, 20, now, 1), 60000);
});

test('节点连续 429 后在原会话继续，不取消兄弟节点，不重发任务正文，汇合正常执行', {timeout: 3000}, async () => {
  const run = new DagRun(), calls = [], completed = [];
  Object.assign(run, {config: {maxConcurrency: 20}, controller: new AbortController(),
    state: {status: 'running', tasks: [[], [], [1, 2]].map((dependencies, i) => ({id: i + 1, session: 'worker-' + (i + 1), dependencies, status: 'pending'}))},
    async initializeIntegration() {}, async save() {}, async release() {this.released = true;}});
  let attempts = 0;
  run.client = {session: {async prompt(input) {
    calls.push(input);
    if (input.path.id === 'worker-1' && attempts++ < 2) return {data: {info: {error: limited({'retry-after-ms': '1'})}}};
    return {data: {parts: [{type: 'text', text: 'done'}]}};
  }}};
  run.runTask = async task => {
    if (task.id === 3) assert.deepEqual(completed, [2, 1]);
    await run.promptTask(task, {directory: '/same/worktree'}, {}, 'original task ' + task.id, run.controller.signal);
    task.status = 'done'; completed.push(task.id);
  };
  await run.execute();
  assert.equal(run.state.status, 'done'); assert.equal(run.failure, undefined);
  assert.equal(run.state.tasks[0].retry.attempt, 2); assert.equal(run.state.tasks[0].retry.waiting, false);
  const retries = calls.filter(call => call.path.id === 'worker-1');
  assert.equal(retries.length, 3); assert.equal(retries[0].body.parts[0].text, 'original task 1');
  for (const call of retries.slice(1)) {
    assert.equal(call.body.parts[0].ignored, true); assert.ok(isDagTransportPart(call.body.parts[0]));
    assert.equal(JSON.stringify(call).includes('original task'), false);
    assert.equal(call.query.directory, '/same/worktree');
  }
});

test('429 等待随用户取消立即停止；401 等非限流错误不自动重试', {timeout: 2000}, async () => {
  const run = new DagRun(), controller = new AbortController();
  let began; const waiting = new Promise(resolve => began = resolve);
  run.save = async () => {}; run.progress = {async update() {began();}};
  run.client = {session: {async prompt() {return {data: {info: {error: limited({'retry-after': '3600'})}}};}}};
  const result = run.promptTask({session: 'same'}, {}, {}, 'task', controller.signal);
  await waiting; controller.abort(new Error('user cancelled'));
  await assert.rejects(result, /user cancelled|aborted/);
  let calls = 0;
  run.client.session.prompt = async () => {calls++; return {data: {info: {error: {name: 'APIError', data: {statusCode: 401}}}}};};
  await assert.rejects(run.promptTask({session: 'same'}, {}, {}, 'task', new AbortController().signal), /401/);
  assert.equal(calls, 1);
});

test('模型请求共享 FIFO 节流和冷却期，取消能排空等待队列', {timeout: 2000}, async () => {
  const gate = new ModelGate(3000), controller = new AbortController(), times = [];
  gate.deferUntil(Date.now() + 30);
  await Promise.all([1, 2, 3].map(() => gate.acquire(controller.signal).then(() => times.push(Date.now()))));
  assert.ok(times[1] - times[0] >= 18); assert.ok(times[2] - times[1] >= 18);
  gate.deferUntil(Date.now() + 3600000);
  const queued = [gate.acquire(controller.signal), gate.acquire(controller.signal)];
  controller.abort(new Error('stop'));
  assert.ok((await Promise.allSettled(queued)).every(result => result.status === 'rejected'));
});
