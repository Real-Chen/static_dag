// Optional real local Gitea smoke test. Two runs provision private repositories
// and retain both PR #1 records. No model calls; unit tests do not run it.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { DagRun } from '../src/dag_run/index.js';
import { git } from '../src/dag_run/git.js';

const url = process.env.GITEA_SMOKE_URL ?? 'http://127.0.0.1:3000';
const owner = process.env.GITEA_SMOKE_OWNER ?? 'dag-agent';
if (!process.env.GITEA_TOKEN) throw new Error('Set GITEA_TOKEN for the fixture account (write:user, write:repository)');
const name = 'dag-isolated-smoke-' + Date.now();
const fixture = await mkdtemp(join(tmpdir(), 'dag-real-gitea-')), repo = join(fixture, 'repo');
const remote = join(fixture, 'origin.git'), evidence = [];
let run, passed = false;
try {
  await mkdir(repo); await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'DAG baseline smoke']); await git(repo, ['config', 'user.email', 'dag-smoke@example.invalid']);
  if (process.platform === 'win32') await git(repo, ['config', 'credential.helper', 'manager']);
  await writeFile(join(repo, '.gitignore'), '.dag/\n'); await writeFile(join(repo, 'README.md'), '# Local baseline fixture\n');
  await git(repo, ['add', '.']); await git(repo, ['commit', '-qm', 'initial local baseline']);
  const baseline = await git(repo, ['rev-parse', 'HEAD']);
  await git(repo, ['clone', '--bare', repo, remote]); await git(repo, ['remote', 'add', 'origin', remote]);
  await writeFile(join(repo, 'remote-only.txt'), 'Old remote main must not be restored.\n');
  await git(repo, ['add', '.']); await git(repo, ['commit', '-qm', 'old remote main content']);
  const oldRemoteMain = await git(repo, ['rev-parse', 'HEAD']);
  await git(repo, ['push', '-u', 'origin', 'main']); await git(repo, ['reset', '--hard', baseline]);
  await mkdir(join(repo, '.dag'));
  await writeFile(join(repo, '.dag/dag.json'), JSON.stringify({tasks: [{id: 1, title: 'Verify local baseline', description: 'Add task result', testStrategy: 'Verify local and remote branch contents', dependencies: []}]}));
  await writeFile(join(repo, '.dag/runner.json'), JSON.stringify({baseBranch: 'main', gitea: {url, owner, repoPrefix: name}}));
  process.env.OPENCODE_EXPERIMENTAL_WORKSPACES = 'true';
  for (let round = 1; round <= 2; round++) {
  const roundBaseline = await git(repo, ['rev-parse', 'HEAD']);
  run = await DagRun.start(repo, `real-gitea-fixture-${round}`, {});
  await run.initializeIntegration();
  assert.equal(run.state.initialCommit, roundBaseline);
  const task = run.state.tasks[0];
  Object.assign(task, {baseCommit: roundBaseline, branch: `dag/${run.state.id}/task-1`, worktree: join(fixture, `task-${round}`), status: 'running'});
  await git(repo, ['worktree', 'add', '-b', task.branch, task.worktree, roundBaseline]);
  await assert.rejects(readFile(join(task.worktree, 'remote-only.txt')), {code: 'ENOENT'});
  await writeFile(join(task.worktree, 'task-result.txt'), `Result from local baseline, run ${round}.\n`);
  await git(task.worktree, ['add', '.']); await git(task.worktree, ['commit', '-qm', 'task result on local baseline']);
  let result;
  for (let attempt = 0; attempt < 10; attempt++) {
    result = await run.submit(task, 'Verify PR target uses this run integration branch after a local reset.');
    if (result.status === 'merged') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(result.status, 'merged', JSON.stringify(result));
  const pr = await run.provider.request(`/pulls/${task.pr}`);
  assert.equal(pr.base.ref, run.state.integrationBranch);
  assert.equal(pr.merged, true);
  assert.equal(task.pr, 1, 'Every new run must start at PR #1');
  assert.equal(await git(repo, ['remote', 'get-url', 'origin']), remote);
  assert.equal(await git(repo, ['rev-parse', 'HEAD']), result.mergeCommit);
  assert.equal((await git(repo, ['ls-remote', 'origin', 'refs/heads/main'])).split(/\s+/)[0], oldRemoteMain);
  assert.equal((await readFile(join(repo, 'task-result.txt'), 'utf8')).trim(), `Result from local baseline, run ${round}.`);
  await assert.rejects(readFile(join(repo, 'remote-only.txt')), {code: 'ENOENT'});
  await run.step({abort: new AbortController().signal, metadata() {}});
  assert.equal(run.state.status, 'done');
  evidence.push({round, repository: run.state.gitea.htmlUrl, pr: pr.html_url, number: task.pr, initialCommit: roundBaseline, mergeCommit: result.mergeCommit});
  }
  assert.notEqual(evidence[0].repository, evidence[1].repository);
  passed = true;
  console.log(JSON.stringify({passed, realGitea: true, localResetRespected: true, oldRemoteMainUnchanged: true,
    independentRepositories: true, evidence}, null, 2));
} finally {
  await run?.release();
  if (passed) {
    const path = relative(tmpdir(), fixture);
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unsafe fixture cleanup path');
    await rm(fixture, {recursive: true, force: true});
  } else console.error('Fixture preserved for inspection:', fixture);
}
