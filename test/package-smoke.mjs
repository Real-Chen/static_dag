import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);
const artifact = resolve(process.argv[2]);
const fixture = await mkdtemp(join(tmpdir(), 'dag packaged-'));
const install = join(fixture, 'install'), repo = join(fixture, 'repo');
let runtime, run, passed = false;
const npmCli = resolve(process.execPath, '../node_modules/npm/bin/npm-cli.js');
const evidence = [];
try {
  await mkdir(install); await mkdir(repo);
  await writeFile(join(install, 'package.json'), '{"private":true}');
  await execute(process.execPath, [npmCli, 'install', artifact, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    {cwd: install, windowsHide: true, timeout: 180000});
  const packageRoot = join(install, 'node_modules/deveco-dag');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'deveco-dag');
  await assert.rejects(readFile(join(packageRoot, '.opencode/plugins/static-dag.js')), {code: 'ENOENT'});
  await assert.rejects(readFile(join(packageRoot, '.npmrc')), {code: 'ENOENT'});
  const {localGitea} = await import(pathToFileURL(join(packageRoot, 'src/runtime/local-gitea.js')));
  const {DagRun} = await import(pathToFileURL(join(packageRoot, 'src/dag_run/index.js')));
  const {git} = await import(pathToFileURL(join(packageRoot, 'src/dag_run/git.js')));
  process.env.DEVECO_DAG_DATA_DIR = join(fixture, "runtime user's 中文");
  process.env.OPENCODE_EXPERIMENTAL_WORKSPACES = 'true';
  process.env.GITEA_TOKEN = 'deliberately-wrong-global-token';
  const services = await Promise.all([localGitea(), localGitea()]);
  [runtime] = services;
  assert.equal(services[0].pid, services[1].pid);
  assert.equal(services[0].url, services[1].url);
  const encrypted = await readFile(join(runtime.dataRoot, 'secrets/token.xml'), 'utf8');
  assert.ok(!encrypted.includes(runtime.token));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Packaged DAG smoke']); await git(repo, ['config', 'user.email', 'package@example.invalid']);
  await writeFile(join(repo, '.gitignore'), '.dag/\n'); await writeFile(join(repo, 'README.md'), '# Packaged fixture\n');
  await git(repo, ['add', '.']); await git(repo, ['commit', '-qm', 'baseline']);
  await mkdir(join(repo, '.dag'));
  await writeFile(join(repo, '.dag/dag.json'), JSON.stringify({tasks: [{id: 1, title: 'Task', description: 'Task', dependencies: [], testStrategy: 'Verify task output'}]}));
  for (let round = 1; round <= 2; round++) {
    run = await DagRun.start(repo, `packaged-${round}`, {});
    await run.initializeIntegration();
    const task = run.state.tasks[0];
    Object.assign(task, {baseCommit: run.state.initialCommit, branch: `dag/${run.state.id}/task-1`, worktree: join(fixture, `task-${round}`), status: 'running'});
    await git(repo, ['worktree', 'add', '-b', task.branch, task.worktree, task.baseCommit]);
    await writeFile(join(task.worktree, 'result.txt'), `Result for run ${round}\n`);
    await git(task.worktree, ['add', '.']); await git(task.worktree, ['commit', '-qm', 'Task result']);
    let submission;
    for (let attempt = 0; attempt < 10; attempt++) {
      submission = await run.submit(task, 'Package-installed Gitea + encrypted credential helper smoke test');
      if (submission.status === 'merged') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(submission.status, 'merged', JSON.stringify(submission));
    assert.equal(task.pr, 1);
    assert.equal(await git(repo, ['rev-parse', 'HEAD']), submission.mergeCommit);
    await run.complete();
    assert.equal(run.state.status, 'done');
    evidence.push({repo: run.state.gitea.repo, pr: task.pr});
  }
  assert.notEqual(evidence[0].repo, evidence[1].repo);
  const gitConfig = await readFile(join(repo, '.git/config'), 'utf8');
  assert.ok(!gitConfig.includes(runtime.token));
  const status = await localGitea('status'); assert.equal(status.running, true);
  console.log(JSON.stringify({passed: true, installedArtifact: artifact, firstUseAutomatic: true, sharedInstance: true,
    realGitea: true, encryptedCredentials: true, pathWithSpacesApostropheAndUnicode: true, evidence, packageRoot}, null, 2));
  if (process.env.DAG_KEEP_PACKAGE_FIXTURE === '1') {console.log('Fixture retained: ' + fixture);}
  passed = true;
} finally {
  await run?.release();
  if (process.env.DAG_KEEP_PACKAGE_FIXTURE !== '1') {
    if (runtime) {
      const current = JSON.parse((await readFile(join(runtime.dataRoot, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
      assert.equal(current.pid, runtime.pid);
      process.kill(runtime.pid);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (passed) {
      const path = relative(tmpdir(), fixture);
      if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unsafe fixture cleanup');
      await rm(fixture, {recursive: true, force: true});
    } else console.error('Failed fixture retained:', fixture);
  }
}
