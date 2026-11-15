# deveco-dag

Windows x64 上的 OpenCode DAG 插件，内置 Gitea 28.3.0。

- `/dag 需求描述`：探索当前工程，生成并校验 `.dag/dag.json`。
- `/dag_run`：按依赖自动执行任务，每节点独立 worktree，通过本机 Gitea PR 提交、合并；冲突交回原 Agent 修复。
- `/dag_panel`：任务看板，点击任务进入原生 Agent 会话；按 ↑ 返回看板。
- `/dag_status`、`/dag_cancel`：刷新状态、取消运行。

## 安装

适配 **OpenCode 1.19.5、Windows x64**。需要已安装 Git、配置 Git 提交身份，并在 OpenCode 中配置模型。此版未适配 OpenCode V2。

```powershell
opencode plugin --global deveco-dag
```

安装命令会根据包内 `./server` 和 `./tui` 入口注册两部分，重启 OpenCode 加载。Gitea 可执行文件已包含在 npm 包中，不在运行时联网下载，不需要 Docker 或管理员权限。

OpenCode 1.19.5 的 Workspace 开关在启动时读取。插件会自动为当前 Windows 用户保存开关；首次启用后，关闭并重新打开终端应用，再启动 OpenCode。也可在启动终端中设置：

```powershell
$env:OPENCODE_EXPERIMENTAL_WORKSPACES = 'true'
opencode
```

## 使用

在已提交代码的 Git 仓库中启动 OpenCode：

```text
/dag 给当前项目添加一个有测试的 greeting 工具
/dag_run
```

首次 `/dag_run` 自动初始化并后台启动本机 Gitea：选择可用的回环端口、创建 SQLite 数据库和专用账号、生成 DPAPI 加密令牌，并为当前 Git 仓库注册仅作用于本机服务地址的凭据助手。无需手动创建 `.dag/runner.json`、部署 Gitea 或设置 GITEA_TOKEN。

每台电脑的当前 Windows 用户共用一个 Gitea 实例；每轮创建独立私有仓库 `<项目前缀>-<runId>`，首个任务 PR 从 `#1` 开始。新一轮以启动 worktree 的当前 HEAD 为基线，不清除已有代码提交；已确认的 PR 合并提交同步回本地，保留原 origin 配置。

任务按依赖并发调度，默认最多同时运行 20 个节点。前置任务的 PR 已合并、本地已同步且 Agent 会话结束后，后续节点才进入就绪队列；有空闲名额就立即启动，无需等待同批次的其他分支。只有一个前置节点时 Fork 其原生会话；没有前置节点或多个前置节点时创建新会话。所有节点使用 `src/dag_run/worker.md` 通用提示词，完成开发、测试和 git commit 后调用 submit_task。PR 提交合并与主工作区同步通过串行队列处理，冲突返回原 Agent 解决后重试。一个节点失败时停止其他活动节点并阻止后续任务。

## 本地数据

默认保存在 `%LOCALAPPDATA%\DevecoDAG\gitea`：数据库、仓库、日志、稳定的 Gitea 程序副本及 DPAPI 加密凭据。该目录仅当前 Windows 用户和 SYSTEM 可访问。npm 更新或卸载不删除历史数据。Gitea 仅监听 `127.0.0.1`，关闭 OpenCode 后继续作为本机后台进程运行；没有安装系统服务或登录启动项。

以下命令可选用，用于提前初始化或查看服务状态：

```powershell
npx deveco-dag setup
npx deveco-dag status
```

运行状态保存在工程 `.dag/runs/<runId>/state.json`；worktree 保存在工程旁 `.dag-worktrees/<工程名>/<runId>/task-<id>`。完成、失败和取消均保留本轮仓库与 PR。取消不回滚已经合并的提交。本版不支持崩溃后自动恢复；不要在运行期间手动移动主 worktree 的 HEAD。

## 可选配置

需要指定命名前缀或限制本地目标分支时，创建 `.dag/runner.json`：

```json
{
  "maxConcurrency": 20,
  "modelRequestsPerMinute": 12,
  "baseBranch": "main",
  "gitea": {"repoPrefix": "my-project"}
}
```

maxConcurrency 是正整数，默认为 20；设为 1 时串行执行。也兼容通过 gitea.url、owner、repoPrefix 指定已有外部 Gitea，此时使用原生 Git 凭据和 GITEA_TOKEN/credential helper。旧 gitea.repo 字段仍可作为命名前缀。详见 src/dag_run/README.md。

modelRequestsPerMinute 可选，限制本轮 DAG 所有节点的模型调用速率，与节点并发数分别控制。示例 12 适用于 16 RPM 服务预留余量；不配置时不预设服务额度。OpenCode 原生重试结束后若仍返回 429，框架遵循 Retry-After（秒/HTTP 日期）或 retry-after-ms，在原 session/worktree 中持续重试并共享冷却期，不因 429 取消其他节点。没有重试次数耗尽后自动结束整轮的规则；可用 /dag_cancel 停止等待。看板显示“等待重试”。权限、鉴权和业务错误仍按失败处理。

## 开发

源码仓库为 https://github.com/errMan404/static_dag 。Git 仓库不保存大体积可执行文件；从 Git 克隆后，先按清单下载并校验 Gitea。发布的 npm 包已包含程序，安装用户无需此步骤。

```powershell
npm install
node scripts/prepare-gitea.mjs
npm test
npm run test:integration
npm run test:run
npm run build
npm pack
```

提示词存放在 prompts 和 src/dag_run/worker.md。发布包含编译后的 TUI、通用服务端源码、提示词和经过 SHA-256 校验的 Gitea 二进制，不包含部署账号、运行数据或发布凭据。修改后需重启 OpenCode。

Gitea 的来源及许可见 THIRD_PARTY_NOTICES.md、vendor/gitea/LICENSE 和 vendor/gitea/THIRD_PARTY_LICENSES.txt。
