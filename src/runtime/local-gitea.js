import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {git} from '../dag_run/git.js';

const execute = promisify(execFile);
const windowsEnvironment = () => {const env = {...process.env}; delete env.PSModulePath; return env;};
function bootstrap(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, {windowsHide: true, env: windowsEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => {stdout += value;}); child.stderr.on('data', value => {stderr += value;});
    const timer = setTimeout(() => {child.kill(); reject(new Error('Gitea bootstrap timed out'));}, 180000);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    // Start-Process can pass inherited pipe handles to Gitea on Windows. Finish
    // when PowerShell exits, not when the persistent service closes those pipes.
    child.once('exit', code => setImmediate(() => {
      clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy();
      if (code === 0) resolve({stdout}); else reject(Object.assign(new Error('Bootstrap failed'), {stderr}));
    }));
  });
}
const manifestUrl = new URL('../../vendor/gitea/manifest.json', import.meta.url);
const script = fileURLToPath(new URL('./local-gitea.ps1', import.meta.url));
export function localDataRoot() {
  if (process.env.DEVECO_DAG_DATA_DIR) return process.env.DEVECO_DAG_DATA_DIR;
  if (!process.env.LOCALAPPDATA) throw new Error('Windows LOCALAPPDATA is unavailable');
  return join(process.env.LOCALAPPDATA, 'DevecoDAG', 'gitea');
}
export function repositoryPrefix(root) {
  const value = basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 40);
  return value || `project-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
}
export async function localGitea(action = 'start') {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此版本的内置 Gitea 支持 Windows x64');
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const binary = fileURLToPath(new URL(`../../vendor/gitea/${manifest.file}`, import.meta.url));
  try {
    const {stdout} = await bootstrap(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-DataRoot', localDataRoot(), '-BinaryPath', binary, '-ExpectedHash', manifest.sha256, '-Action', action]);
    return JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
  } catch (error) {
    // execFile error messages include stdout; stdout can contain a token.
    const reason = String(error.stderr ?? '').trim().slice(0, 500);
    throw new Error(`本地 Gitea 初始化失败${reason ? '：' + reason : '，请查看用户数据目录中的 log'}`);
  }
}
export async function configureLocalGit(root, runtime) {
  // URL-scoped helper: no token in Git config, environment, URLs or model input.
  // Use a stable helper path so npm upgrades/cache eviction cannot break Git.
  const helper = join(runtime.dataRoot, 'git-credential.ps1').replaceAll('\\', '/').replaceAll("'", "'\\''");
  const key = `credential.${runtime.url}.helper`;
  await git(root, ['config', '--local', '--replace-all', key, '']);
  await git(root, ['config', '--local', '--add', key, `!powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${helper}'`]);
}
export async function loadRunnerConfig(root) {
  let config;
  try { config = JSON.parse(await readFile(join(root, '.dag/runner.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('.dag/runner.json 不是有效 JSON，请修正后重试'); config = {}; }
  if (config.gitea?.url) return {config};
  const runtime = await localGitea();
  await configureLocalGit(root, runtime);
  config.gitea = {url: runtime.url, owner: runtime.owner, repoPrefix: config.gitea?.repoPrefix ?? repositoryPrefix(root)};
  return {config, token: runtime.token};
}
export async function enableWorkspaces() {
  if (process.platform !== 'win32') return false;
  if (['true', '1'].includes(process.env.OPENCODE_EXPERIMENTAL_WORKSPACES)) return true;
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::SetEnvironmentVariable('OPENCODE_EXPERIMENTAL_WORKSPACES', 'true', 'User')"], {windowsHide: true, env: windowsEnvironment(), timeout: 10000});
  return false; // Host reads this flag before plugin loading. A restart is required.
}
