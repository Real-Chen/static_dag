// Read the publishing token from stdin; never put it in source, argv or .npmrc.
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

async function main() {
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = createInterface({input: process.stdin, terminal: false});
const token = await new Promise(resolve => input.once('line', line => {input.close(); resolve(line.trim());}));
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
if (!token) throw new Error('Publishing token is required on stdin');
const auth = {Authorization: `Bearer ${token}`};
const response = await fetch('https://registry.npmjs.org/-/whoami', {headers: auth, signal: AbortSignal.timeout(20000)});
if (!response.ok) {console.error(`npm authentication failed: HTTP ${response.status}`); process.exitCode = 1; return;}
const {username} = await response.json();
console.log(JSON.stringify({authenticated: true, username}));
if (process.argv.includes('--preflight')) {
  const {name} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify({package: name}));
  return;
}
const temporary = await mkdtemp(join(tmpdir(), 'dag-npm-publish-'));
try {
  const config = join(temporary, 'npmrc');
  await writeFile(config, 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${DAG_NPM_PUBLISH_TOKEN}\n', {mode: 0o600});
  const artifact = process.argv.find(arg => arg.endsWith('.tgz'));
  const stageList = process.argv.includes('--stage-list');
  const approvalIndex = process.argv.indexOf('--stage-approve');
  const viewIndex = process.argv.indexOf('--stage-view');
  const stageMode = stageList || approvalIndex >= 0 || viewIndex >= 0;
  if (!artifact && !stageMode) throw new Error('Pass a tested .tgz artifact');
  const npmCli = stageMode ? resolve('.test-tmp/npm-stage-tools/node_modules/npm/bin/npm-cli.js')
    : process.env.npm_execpath ?? resolve(process.execPath, '../node_modules/npm/bin/npm-cli.js');
  const args = stageList ? ['stage', 'list', 'deveco-dag', '--json']
    : approvalIndex >= 0 ? ['stage', 'approve', process.argv[approvalIndex + 1]]
    : viewIndex >= 0 ? ['stage', 'view', process.argv[viewIndex + 1], '--json']
    : ['publish', resolve(artifact), '--access', 'public'];
  const child = spawn(process.execPath, [npmCli, ...args, '--userconfig', config], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, DAG_NPM_PUBLISH_TOKEN: token}});
  let output = '';
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);});
  console.log(output.replaceAll(token, '[redacted]'));
  process.exitCode = code ?? 1;
} finally {
  const within = relative(tmpdir(), temporary);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Invalid cleanup path');
  await rm(temporary, {recursive: true, force: true});
}
}
await main();
