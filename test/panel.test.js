import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPanel } from '../src/dag_run/tui-controller.js';
import { viewFromPart } from '../src/dag_run/panel-model.js';

test('面板随事件更新；只进入已创建的原生会话；从子会话取消仍作用于主 DAG', async () => {
  const store = new Map(), commands = [], navigation = [], controls = [], toasts = [], layers = [];
  let handler, props, route;
  const view = {id: 'run-1', root: 'D:\\repo', parent: 'parent', status: 'running', tasks: [
    {id: 1, title: '基础模块', dependencies: [], status: 'running', session: 'worker-1'},
    {id: 2, title: '后续模块', dependencies: [1], status: 'pending'}]};
  const api = {
    state: {path: {worktree: 'D:\\repo'}}, kv: {get: key => store.get(key), set: (key, value) => store.set(key, value)},
    event: {on(type, fn) {handler = fn; return () => {}; }}, lifecycle: {onDispose() {}},
    keymap: {registerLayer(input) {layers.push(input); commands.push(...input.commands);}},
    route: {current: {name: 'session', params: {sessionID: 'parent'}}, register(routes) {route = routes[0];}, navigate(...args) {navigation.push(args); api.route.current = {name: args[0], params: args[1]};}},
    ui: {toast: value => toasts.push(value), DialogSelect(input) {props = input;}, dialog: {replace(render) {render();}, setSize() {}, clear() {}}},
    client: {session: {async messages() {return {data: [{parts: [{metadata: {dagView: view}}]}]};}, async prompt(input) {controls.push(input); return {data: {}};}}}
  };
  await installPanel(api, input => {props = input;});
  await commands.find(command => command.slashName === 'dag_panel').run();
  assert.equal(api.route.current.name, 'static-dag.dashboard');
  route.render();
  assert.equal(props.view().tasks.length, 2); assert.deepEqual(props.view().tasks[1].dependencies, [1]);
  const before = navigation.length;
  props.open(props.view().tasks[1]); assert.equal(navigation.length, before); assert.match(toasts.at(-1).message, /尚未创建/);
  props.open(props.view().tasks[0]); assert.deepEqual(navigation.at(-1), ['session', {sessionID: 'worker-1'}]);
  const returnLayer = layers.find(layer => layer.bindings.some(binding => binding.cmd === 'static-dag.detail.back'));
  assert.equal(returnLayer.mode, 'base'); assert.ok(returnLayer.enabled());
  const taskView = props.view();
  // A newer run in the same repository must not steal an older Agent's return path.
  handler({properties: {part: {metadata: {dagView: {...view, id: 'run-2', tasks: [{id: 1, session: 'other-worker', dependencies: []}]}}}}});
  assert.equal(props.view().id, 'run-1');
  commands.find(command => command.name === 'static-dag.detail.back').run();
  assert.deepEqual(navigation.at(-1), ['static-dag.dashboard', {root: 'D:\\repo', parent: 'parent', runId: 'run-1', focusTask: 1}]);
  assert.equal(returnLayer.enabled(), false);
  props.open(taskView.tasks[0]);
  api.state.path.worktree = 'D:\\repo-worktrees\\old-source-path';
  await commands.find(command => command.slashName === 'dag_cancel').run();
  assert.equal(controls.at(-1).sessionID, 'parent'); assert.equal(controls.at(-1).noReply, true);
  assert.equal(controls.at(-1).parts[0].metadata.dagControl.action, 'cancel');
  handler({properties: {part: {metadata: {dagView: {...view, status: 'done', tasks: view.tasks.map(task => ({...task, status: 'done'}))}}}}});
  assert.equal(props.view().status, 'done'); assert.ok(props.view().tasks.every(task => task.status === 'done'));
  props.back(); assert.deepEqual(navigation.at(-1), ['session', {sessionID: 'parent'}]);
  assert.equal(returnLayer.enabled(), false, '主会话保持原生方向键行为');
  api.route.current = {name: 'session', params: {sessionID: 'unrelated-agent'}};
  assert.equal(returnLayer.enabled(), false, '普通 Agent 保持原生方向键行为');
  api.state.path.worktree = 'D:\\repo';
  api.route.current = {name: 'session', params: {sessionID: 'fresh-session'}};
  assert.equal(props.view(), undefined, '同一工作区的新 session 不得继承旧 DAG');
  const calls = controls.length;
  await commands.find(command => command.slashName === 'dag_status').run();
  assert.equal(controls.length, calls, '新 session 查询状态不得向旧主会话发控制消息');
  assert.equal(api.route.current.params.parent, 'fresh-session');
  assert.equal(props.view(), undefined);
  await commands.find(command => command.slashName === 'dag_run').run();
  assert.equal(controls.at(-1).sessionID, 'fresh-session');
  assert.equal(controls.at(-1).parts[0].synthetic, true);
  assert.equal(props.view().parent, 'fresh-session');
  api.route.current = {name: 'session', params: {sessionID: 'worker-1'}};
  assert.equal(props.view().id, 'run-1', '旧任务仍能回到自己所属的运行批次');
});

test('只隐藏插件的控制及状态消息，保留内容、metadata 和普通用户消息', async () => {
  const updates = []; let detail;
  const api = {
    state: {path: {worktree: 'D:\\repo'}}, kv: {get() {}, set() {}},
    event: {on() {return () => {};}}, lifecycle: {onDispose() {}},
    route: {current: {name: 'session', params: {sessionID: 'old-parent'}}, register() {}},
    keymap: {registerLayer() {}}, ui: {dialog: {}},
    slots: {register(plugin) {plugin.slots.app_bottom();}},
    client: {part: {async update(input) {updates.push(input); return {data: input.part};}}}
  };
  await installPanel(api, () => {}, input => {detail = input;});
  const control = {type: 'text', id: 'control', sessionID: 'old-parent', messageID: 'm1', text: '/dag_run', metadata: {dagControl: {action: 'start', root: 'D:\\repo'}}};
  const progress = {type: 'text', id: 'progress', sessionID: 'old-parent', messageID: 'm2', text: 'DAG 已完成', metadata: {dagProgress: true, dagView: {status: 'done'}}};
  const user = {type: 'text', id: 'user', sessionID: 'old-parent', messageID: 'm3', text: '/dag_run'};
  await detail.hideTransport(control); await detail.hideTransport(progress); await detail.hideTransport(user);
  assert.equal(updates.length, 2);
  assert.ok(updates.every(input => input.part.synthetic && input.part.ignored));
  assert.equal(updates[0].part.text, control.text); assert.deepEqual(updates[1].part.metadata, progress.metadata);
  assert.equal(updates[0].part.metadata.dagControlHandled, true, '隐藏历史控制消息不得触发重放');
  assert.equal(control.synthetic, undefined, '不原地修改宿主 store 对象');
});

test('旧版完成记录恢复固定耗时，运行中的记录保留实时字段', () => {
  const old = {text: '状态：已完成 · 耗时 152 秒', metadata: {dagView: {startedAt: 1000, status: 'done'}}};
  assert.equal(viewFromPart(old).updatedAt, 153000);
  assert.equal(old.metadata.dagView.updatedAt, undefined);
  const live = {metadata: {dagView: {status: 'running', startedAt: 1000, updatedAt: 2000}}};
  assert.equal(viewFromPart(live), live.metadata.dagView);
});
