import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const parent = join(tmpdir(), 'static-dag-native'); await mkdir(parent, { recursive: true });
const fixture = await mkdtemp(join(parent, 'run-'));
execFileSync('git', ['init', '--quiet', fixture], { windowsHide: true });
const directory = join(fixture, 'nested'); await mkdir(directory);
await writeFile(join(fixture, 'README.md'), '# Existing project\n');
const target = join(fixture, '.dag', 'dag.json');
const task = (id, dependencies = []) => ({ id, title: `Task ${id}`, description: '明确目标', details: '实施说明', testStrategy: '相关测试通过', dependencies, priority: 'medium', status: 'pending' });
const dag = { tasks: [task(1), task(2, [1]), task(3, [1])] };
let stage = 0, requests = 0, failure;
function reply(res, data) {
  const common = { id: 'chatcmpl-' + randomUUID(), model: 'fake', created: Math.floor(Date.now() / 1000), object: 'chat.completion.chunk' };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = data.tool_calls ? { role: 'assistant', tool_calls: data.tool_calls.map((v, index) => ({ ...v, index })) } : { role: 'assistant', content: data.content };
  res.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: data.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }) + '\n\n');
  res.end('data: [DONE]\n\n');
}
const call = (name, args) => ({ tool_calls: [{ id: 'call_' + randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const model = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.tools?.some(t => t.function.name === 'write')) return reply(res, { content: 'DAG planning' });
    requests++;
    assert.ok(!body.tools.some(t => t.function.name === 'parse_prd'));
    if (stage === 0) {
      assert.ok(JSON.stringify(body.messages).includes('根据实际复杂度自行确定任务数量'));
      stage++; return reply(res, call('read', { filePath: join(fixture, 'README.md') }));
    }
    if (stage === 1) { stage++; return reply(res, call('write', { filePath: target, content: JSON.stringify({ tasks: [task(1, [99])] }) })); }
    if (stage === 2) {
      await assert.rejects(readFile(target), /ENOENT/, '无效的首次写入不能触碰文件');
      assert.ok(JSON.stringify(body.messages).includes('DAG 校验失败'));
      stage++; return reply(res, call('write', { filePath: target, content: JSON.stringify(dag) }));
    }
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), dag);
    stage++; reply(res, { content: `DAG 已生成：${target}；3 个任务，任务 2、3 可并行。` });
  } catch (error) { failure = error; res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const config = { model: 'fixture/fake', small_model: 'fixture/fake', enabled_providers: ['fixture'], autoupdate: false,
  plugin: [pathToFileURL(resolve('src/plugin.js')).href], provider: { fixture: { name: 'local fixture', npm: '@ai-sdk/openai-compatible',
    options: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'local-test-only' }, models: { fake: { name: 'fake', limit: { context: 64000, output: 4000 } } } } } };
if (process.argv.includes('--global')) delete config.plugin;
const password = randomUUID();
const child = spawn(process.env.OPENCODE_BIN ?? 'D:\\APP\\node_js\\node_modules\\opencode-ai\\bin\\opencode.exe', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
  cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_SERVER_USERNAME: 'dag-test', OPENCODE_SERVER_PASSWORD: password } });
let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
try {
  const origin = await new Promise((done, reject) => {
    const timer = setInterval(() => { const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearInterval(timer); clearTimeout(deadline); done(url); } }, 50);
    const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('启动超时: ' + logs.slice(-1000))); }, 40000);
    child.once('error', reject);
  });
  const api = async (path, method = 'GET', body) => {
    const result = await fetch(origin + path + '?directory=' + encodeURIComponent(directory), { method,
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('dag-test:' + password).toString('base64') },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const data = await result.json(); assert.ok(result.ok, JSON.stringify(data)); return data;
  };
  assert.ok((await api('/command')).some(c => c.name === 'dag'));
  const session = await api('/session', 'POST', { title: 'DAG native integration' });
  await api(`/session/${session.id}/command`, 'POST', { command: 'dag', arguments: '为现有项目规划适配，两个开发任务可并行' });
  if (failure) throw failure;
  assert.equal(stage, 4, `未走完原生规划流程，stage=${stage}`);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), dag);
  await assert.rejects(readFile(join(directory, '.dag', 'dag.json')), /ENOENT/);
  const history = await api(`/session/${session.id}/message`);
  const parts = history.flatMap(m => m.parts);
  assert.ok(parts.some(p => p.type === 'tool' && p.tool === 'write' && p.state.status === 'error'));
  assert.ok(parts.some(p => p.type === 'tool' && p.tool === 'write' && p.state.metadata?.dagValidated));
  assert.ok(parts.some(p => p.type === 'text' && p.text.includes('3 个任务')));
  assert.equal((await api('/session')).filter(s => s.id === session.id || s.parentID === session.id).length, 1, '不创建后台子会话');
  console.log(JSON.stringify({ passed: true, native_opencode: '1.19.5', global: process.argv.includes('--global'), model_requests: requests, invalid_write_rejected: true, worktree_root_verified: true, native_tool_progress: true }));
} catch (error) { console.error(error.stack, '\nSERVER:', logs.slice(-1000)); process.exitCode = 1; }
finally {
  child.kill(); if (child.exitCode === null) await new Promise(done => child.once('close', done));
  model.closeAllConnections(); await new Promise(done => model.close(done));
  const rel = relative(parent, fixture); if (!rel || rel.startsWith('..')) throw new Error('拒绝清理越界目录');
  await rm(fixture, { recursive: true, force: true });
}
