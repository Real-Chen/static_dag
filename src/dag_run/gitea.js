export class Gitea {
  constructor(config, token = process.env.GITEA_TOKEN) {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Gitea URL 必须为 HTTP(S)');
    this.url = url.href.replace(/\/$/, ''); this.token = token; this.config = config;
    if (!token || !config.owner) throw new Error('请配置 Gitea owner 和访问令牌');
    const prefix = config.repoPrefix ?? config.repo;
    if (typeof prefix !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(prefix)) throw new Error('gitea.repoPrefix 须为 1–60 位字母、数字、点、下划线或连字符，首位为字母或数字；兼容使用旧 repo 字段作为前缀');
    if (config.ownerType && !['user', 'organization'].includes(config.ownerType)) throw new Error('gitea.ownerType 必须为 user 或 organization');
  }
  async api(path, method = 'GET', body, signal) {
    const response = await fetch(this.url + '/api/v1' + path, { method,
      headers: { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (!response.ok) throw Object.assign(new Error(`Gitea HTTP ${response.status}: ${data.message ?? text}`), { status: response.status, data });
    return data;
  }
  async request(path, method = 'GET', body) {
    if (!this.repo) throw new Error('本轮 Gitea 仓库尚未创建');
    return this.api(this.repo + path, method, body);
  }
  async createRunRepository(run, signal) {
    const {owner, ownerType = 'user'} = this.config;
    try {
      if (ownerType === 'user') {
        const user = await this.api('/user', 'GET', undefined, signal);
        if (user.login?.toLowerCase() !== owner.toLowerCase()) throw new Error('gitea.owner 必须为令牌所属用户；组织仓库请设置 ownerType: organization');
      }
      const endpoint = ownerType === 'organization' ? `/orgs/${encodeURIComponent(owner)}/repos` : '/user/repos';
      const repository = await this.api(endpoint, 'POST', {name: run.gitea.repo, private: true, auto_init: false,
        default_branch: run.integrationBranch, description: `DAG run ${run.id}; baseline ${run.initialCommit}`}, signal);
      if (repository.name !== run.gitea.repo || repository.owner?.login?.toLowerCase() !== owner.toLowerCase() || !repository.clone_url) throw new Error('Gitea 返回的仓库身份或 clone_url 不正确，停止运行');
      this.repo = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository.name)}`;
      return {url: this.url, owner, repo: repository.name, htmlUrl: repository.html_url, cloneUrl: repository.clone_url};
    } catch (error) {
      if (error.status === 403) throw new Error(`创建本轮 Gitea 仓库被拒绝：${error.message}。个人仓库令牌需要 write:user 和 write:repository，且允许访问新建仓库；组织仓库还需 write:organization 和组织建仓权限。`);
      // A collision must fail, never reuse another run's repository/PR counter.
      throw error;
    }
  }
  async submit(node, base, summary, head) {
    let current;
    try {
      if (!node.pr) node.pr = (await this.request('/pulls', 'POST', { head: node.branch, base, title: `DAG 任务 ${node.id}: ${node.title}`, body: summary })).number;
      let pr = await this.request(`/pulls/${node.pr}`);
      current = pr;
      if (!pr.merged) {
        await this.request(`/pulls/${node.pr}/merge`, 'POST', { Do: 'merge', head_commit_id: head, delete_branch_after_merge: false });
        pr = await this.request(`/pulls/${node.pr}`);
      }
      return { status: pr.merged ? 'merged' : 'pending', pr: node.pr, url: pr.html_url, mergeCommit: pr.merge_commit_sha, baseBranch: base };
    } catch (error) {
      const conflict = error.status === 409 || (error.status === 405 && current?.mergeable === false);
      return { status: conflict ? 'conflict' : 'blocked', pr: node.pr, baseBranch: base, message: error.message, httpStatus: error.status, details: error.data,
        action: conflict ? `git fetch 后将本次 PR 的目标分支 ${base} merge 到任务分支，解决冲突、测试、git commit，再调用 submit_task。不要使用其他分支替代本轮目标。` : '检查 Gitea 权限、审核和 CI 状态；未合并不能标记完成。' };
    }
  }
}
