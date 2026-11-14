import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Gitea} from '../src/dag_run/gitea.js';

test('创建私有空仓库，拒绝重用同名仓库；权限或账号错误时明确失败', async t => {
  const calls = [], repositories = new Set(); let forbidden = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({path: req.url, method: req.method, body});
    const send = (status, data) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(data));};
    if (forbidden) return send(403, {message: 'required scope: write:user'});
    if (req.url === '/api/v1/user') return send(200, {login: 'worker'});
    if (req.method === 'POST') {
      if (repositories.has(body.name)) return send(409, {message: 'repository already exists'});
      repositories.add(body.name);
      return send(201, {name: body.name, owner: {login: 'worker'}, clone_url: 'http://localhost/worker/' + body.name + '.git', html_url: 'http://localhost/worker/' + body.name});
    }
    return send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const config = {url: `http://127.0.0.1:${server.address().port}`, owner: 'worker', repoPrefix: 'project'};
  const api = new Gitea(config, 'fixture');
  await assert.rejects(api.request('/pulls'), /尚未创建/);
  const run = {id: 'run-a', initialCommit: 'baseline', integrationBranch: 'dag/run-a/integration', gitea: {repo: 'project-run-a'}};
  const repository = await api.createRunRepository(run);
  assert.equal(repository.repo, 'project-run-a');
  assert.equal(calls[1].path, '/api/v1/user/repos');
  assert.equal(calls[1].body.private, true); assert.equal(calls[1].body.auto_init, false);
  assert.equal(calls[1].body.default_branch, run.integrationBranch);
  await assert.rejects(api.createRunRepository(run), {status: 409});
  assert.ok(calls.every(call => !call.path.includes('/repos/worker/')), '同名仓库不得查询复用');
  const before = calls.length;
  await assert.rejects(new Gitea({...config, owner: 'other'}, 'fixture').createRunRepository(run), /令牌所属用户/);
  assert.equal(calls.length, before + 1, '账号不匹配不得建到其他用户下');
  forbidden = true;
  await assert.rejects(api.createRunRepository(run), /write:user.*write:repository/);
  assert.equal(repositories.size, 1);
});
