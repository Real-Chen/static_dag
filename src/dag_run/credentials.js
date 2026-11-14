import { execFile } from 'node:child_process';

// Reuse git push's credential helper. Never log helper output or prompt from a tool.
export async function resolveGiteaToken(root, config) {
  if (process.env.GITEA_TOKEN) return process.env.GITEA_TOKEN;
  const url = new URL(config.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Gitea URL 必须为 HTTP(S)');
  const input = `protocol=${url.protocol.slice(0, -1)}\nhost=${url.host}\npath=${url.pathname.replace(/^\//, '')}\n\n`;
  try {
    const credential = await new Promise((resolve, reject) => {
      const child = execFile('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
        cwd: root, windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_ASKPASS: '', SSH_ASKPASS: '' }
      }, (error, stdout) => error ? reject(new Error('凭据读取失败')) : resolve(stdout));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
    const password = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (password) return password;
  } catch { /* Helper errors can contain credentials; do not propagate them. */ }
  throw new Error('没有可用的 Gitea API Token。请在 Git 凭据管理器保存该 Gitea 地址的访问令牌，或设置 GITEA_TOKEN。');
}
