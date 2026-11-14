import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { labels } from '../src/dag_run/panel-model.js';
export function Dashboard(props) {
  const api = props.api;
  const theme = () => api.theme.current;
  const [selected, setSelected] = createSignal(Math.max(0, props.view()?.tasks?.findIndex(task => task.id === props.focusTask) ?? 0));
  const [now, setNow] = createSignal(Date.now());
  const observedAt = Date.now();
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const view = () => props.view();
  const tasks = () => view()?.tasks ?? [];
  const done = () => tasks().filter(t => t.status === 'done').length;
  const percent = () => tasks().length ? Math.round(done() * 100 / tasks().length) : 0;
  const running = () => view()?.status === 'running';
  const status = () => labels[view()?.status] ?? view()?.status ?? '未运行';
  const color = state => state === 'done' ? theme().success : state === 'running' ? theme().primary : ['failed', 'blocked', 'cancelled', '启动失败'].includes(state) ? theme().error : theme().textMuted;
  const elapsed = () => {
    const seconds = Math.floor(((running() ? now() : view()?.updatedAt ?? observedAt) - (view()?.startedAt ?? observedAt)) / 1000);
    return seconds < 60 ? `${Math.max(0, seconds)} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  };
  const open = () => props.open(tasks()[selected()]);
  const unregister = api.keymap.registerLayer({
    get enabled() {
      return api.route.current.name === 'static-dag.dashboard';
    },
    commands: [{
      name: 'static-dag.page.up',
      run() {
        setSelected(i => Math.max(0, i - 1));
      }
    }, {
      name: 'static-dag.page.down',
      run() {
        setSelected(i => Math.min(Math.max(0, tasks().length - 1), i + 1));
      }
    }, {
      name: 'static-dag.page.open',
      run: open
    }, {
      name: 'static-dag.page.back',
      run: props.back
    }, {
      name: 'static-dag.page.refresh',
      run: props.refresh
    }, {
      name: 'static-dag.page.cancel',
      run() {
        if (running()) props.cancel();
      }
    }],
    bindings: [{
      key: 'up',
      cmd: 'static-dag.page.up'
    }, {
      key: 'down',
      cmd: 'static-dag.page.down'
    }, {
      key: 'enter',
      cmd: 'static-dag.page.open'
    }, {
      key: 'escape',
      cmd: 'static-dag.page.back'
    }, {
      key: 'r',
      cmd: 'static-dag.page.refresh'
    }, {
      key: 'c',
      cmd: 'static-dag.page.cancel'
    }]
  });
  if (typeof unregister === 'function') onCleanup(unregister);
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("box"),
      _el$3 = _$createElement("text"),
      _el$4 = _$createElement("b"),
      _el$6 = _$createElement("text"),
      _el$7 = _$createElement("text"),
      _el$1 = _$createElement("box"),
      _el$10 = _$createElement("box"),
      _el$11 = _$createElement("text"),
      _el$12 = _$createTextNode(` / `),
      _el$13 = _$createTextNode(` 个任务已完成 · 执行中 `),
      _el$14 = _$createTextNode(` · 并发上限 `),
      _el$15 = _$createElement("text"),
      _el$16 = _$createElement("text"),
      _el$17 = _$createElement("span"),
      _el$18 = _$createTextNode(` `),
      _el$19 = _$createTextNode(`%`),
      _el$20 = _$createElement("text"),
      _el$21 = _$createElement("box"),
      _el$22 = _$createElement("text"),
      _el$24 = _$createElement("text"),
      _el$26 = _$createElement("text"),
      _el$28 = _$createElement("text"),
      _el$30 = _$createElement("text"),
      _el$32 = _$createElement("scrollbox"),
      _el$36 = _$createElement("box"),
      _el$37 = _$createElement("text"),
      _el$39 = _$createElement("text"),
      _el$40 = _$createTextNode(`r 刷新`),
      _el$41 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$7);
    _$insertNode(_el$, _el$1);
    _$insertNode(_el$, _el$21);
    _$insertNode(_el$, _el$32);
    _$insertNode(_el$, _el$36);
    _$insertNode(_el$, _el$41);
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "height", "100%");
    _$setProp(_el$, "padding", 2);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$6);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "justifyContent", "space-between");
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$4, _$createTextNode(`DAG 任务看板`));
    _$insert(_el$6, status);
    _$setProp(_el$7, "truncate", true);
    _$insert(_el$7, () => view()?.root ?? props.root());
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return view()?.gitea?.repo;
      },
      get children() {
        var _el$8 = _$createElement("text"),
          _el$9 = _$createTextNode(`本轮仓库：`),
          _el$0 = _$createTextNode(`/`);
        _$insertNode(_el$8, _el$9);
        _$insertNode(_el$8, _el$0);
        _$setProp(_el$8, "truncate", true);
        _$insert(_el$8, () => view()?.gitea?.owner, _el$0);
        _$insert(_el$8, () => view()?.gitea?.repo, null);
        _$effect(_$p => _$setProp(_el$8, "fg", theme().textMuted, _$p));
        return _el$8;
      }
    }), _el$1);
    _$insertNode(_el$1, _el$10);
    _$insertNode(_el$1, _el$16);
    _$insertNode(_el$1, _el$20);
    _$setProp(_el$1, "padding", 1);
    _$setProp(_el$1, "flexDirection", "column");
    _$setProp(_el$1, "gap", 1);
    _$insertNode(_el$10, _el$11);
    _$insertNode(_el$10, _el$15);
    _$setProp(_el$10, "flexDirection", "row");
    _$setProp(_el$10, "justifyContent", "space-between");
    _$insertNode(_el$11, _el$12);
    _$insertNode(_el$11, _el$13);
    _$insertNode(_el$11, _el$14);
    _$insert(_el$11, done, _el$12);
    _$insert(_el$11, () => tasks().length, _el$13);
    _$insert(_el$11, () => tasks().filter(task => task.status === 'running').length, _el$14);
    _$insert(_el$11, () => view()?.maxConcurrency ?? 1, null);
    _$insert(_el$15, elapsed);
    _$insertNode(_el$16, _el$17);
    _$insertNode(_el$16, _el$18);
    _$insertNode(_el$16, _el$19);
    _$insert(_el$16, () => '━'.repeat(Math.round(percent() / 5)), _el$17);
    _$insert(_el$17, () => '─'.repeat(20 - Math.round(percent() / 5)));
    _$insert(_el$16, percent, _el$19);
    _$setProp(_el$20, "wrapMode", "word");
    _$insert(_el$20, () => view()?.detail ?? '使用 /dag_run 启动当前工作区的 DAG。');
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$21, _el$24);
    _$insertNode(_el$21, _el$26);
    _$insertNode(_el$21, _el$28);
    _$insertNode(_el$21, _el$30);
    _$setProp(_el$21, "flexDirection", "row");
    _$setProp(_el$21, "paddingLeft", 1);
    _$setProp(_el$21, "paddingRight", 1);
    _$setProp(_el$21, "gap", 2);
    _$insertNode(_el$22, _$createTextNode(`编号`));
    _$setProp(_el$22, "width", 4);
    _$insertNode(_el$24, _$createTextNode(`任务`));
    _$setProp(_el$24, "flexGrow", 1);
    _$insertNode(_el$26, _$createTextNode(`状态`));
    _$setProp(_el$26, "width", 10);
    _$insertNode(_el$28, _$createTextNode(`前置依赖`));
    _$setProp(_el$28, "width", 12);
    _$insertNode(_el$30, _$createTextNode(`PR`));
    _$setProp(_el$30, "width", 8);
    _$setProp(_el$32, "flexGrow", 1);
    _$insert(_el$32, _$createComponent(For, {
      get each() {
        return tasks();
      },
      children: (task, index) => (() => {
        var _el$43 = _$createElement("box"),
          _el$44 = _$createElement("text"),
          _el$45 = _$createElement("text"),
          _el$46 = _$createElement("text"),
          _el$47 = _$createElement("text"),
          _el$48 = _$createElement("text");
        _$insertNode(_el$43, _el$44);
        _$insertNode(_el$43, _el$45);
        _$insertNode(_el$43, _el$46);
        _$insertNode(_el$43, _el$47);
        _$insertNode(_el$43, _el$48);
        _$setProp(_el$43, "flexDirection", "row");
        _$setProp(_el$43, "gap", 2);
        _$setProp(_el$43, "paddingLeft", 1);
        _$setProp(_el$43, "paddingRight", 1);
        _$setProp(_el$43, "height", 2);
        _$setProp(_el$43, "onMouseUp", () => {
          setSelected(index());
          props.open(task);
        });
        _$setProp(_el$44, "width", 4);
        _$insert(_el$44, () => task.id);
        _$setProp(_el$45, "flexGrow", 1);
        _$setProp(_el$45, "flexShrink", 1);
        _$setProp(_el$45, "truncate", true);
        _$insert(_el$45, () => task.title);
        _$setProp(_el$46, "width", 10);
        _$insert(_el$46, () => labels[task.status] ?? task.status);
        _$setProp(_el$47, "width", 12);
        _$insert(_el$47, (() => {
          var _c$ = _$memo(() => !!task.dependencies.length);
          return () => _c$() ? task.dependencies.join(', ') : '—';
        })());
        _$setProp(_el$48, "width", 8);
        _$insert(_el$48, (() => {
          var _c$2 = _$memo(() => !!task.pr);
          return () => _c$2() ? '#' + task.pr : '—';
        })());
        _$effect(_p$ => {
          var _v$17 = index() === selected() ? theme().backgroundElement : theme().background,
            _v$18 = theme().textMuted,
            _v$19 = theme().text,
            _v$20 = color(task.status),
            _v$21 = theme().textMuted,
            _v$22 = task.pr ? theme().primary : theme().textMuted;
          _v$17 !== _p$.e && (_p$.e = _$setProp(_el$43, "backgroundColor", _v$17, _p$.e));
          _v$18 !== _p$.t && (_p$.t = _$setProp(_el$44, "fg", _v$18, _p$.t));
          _v$19 !== _p$.a && (_p$.a = _$setProp(_el$45, "fg", _v$19, _p$.a));
          _v$20 !== _p$.o && (_p$.o = _$setProp(_el$46, "fg", _v$20, _p$.o));
          _v$21 !== _p$.i && (_p$.i = _$setProp(_el$47, "fg", _v$21, _p$.i));
          _v$22 !== _p$.n && (_p$.n = _$setProp(_el$48, "fg", _v$22, _p$.n));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined
        });
        return _el$43;
      })()
    }), null);
    _$insert(_el$32, _$createComponent(Show, {
      get when() {
        return !tasks().length;
      },
      get children() {
        var _el$33 = _$createElement("text");
        _$insertNode(_el$33, _$createTextNode(`暂无任务`));
        _$effect(_$p => _$setProp(_el$33, "fg", theme().textMuted, _$p));
        return _el$33;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return tasks()[selected()]?.error;
      },
      get children() {
        var _el$35 = _$createElement("text");
        _$setProp(_el$35, "wrapMode", "word");
        _$insert(_el$35, () => tasks()[selected()]?.error);
        _$effect(_$p => _$setProp(_el$35, "fg", theme().error, _$p));
        return _el$35;
      }
    }), _el$36);
    _$insertNode(_el$36, _el$37);
    _$insertNode(_el$36, _el$39);
    _$setProp(_el$36, "flexDirection", "row");
    _$setProp(_el$36, "justifyContent", "space-between");
    _$insertNode(_el$37, _$createTextNode(`↑↓ 选择 · Enter / 点击 查看 Agent · Esc 返回会话`));
    _$insertNode(_el$39, _el$40);
    _$insert(_el$39, () => running() ? ' · c 取消运行' : '', null);
    _$insertNode(_el$41, _$createTextNode(`Agent 详情中按 ↑ 或点击底部「返回 DAG 看板」回到这里。`));
    _$effect(_p$ => {
      var _v$ = theme().background,
        _v$2 = theme().text,
        _v$3 = color(view()?.status),
        _v$4 = theme().textMuted,
        _v$5 = theme().backgroundPanel,
        _v$6 = theme().text,
        _v$7 = theme().textMuted,
        _v$8 = theme().primary,
        _v$9 = theme().textMuted,
        _v$0 = view()?.status === '启动失败' ? theme().error : theme().textMuted,
        _v$1 = theme().textMuted,
        _v$10 = theme().textMuted,
        _v$11 = theme().textMuted,
        _v$12 = theme().textMuted,
        _v$13 = theme().textMuted,
        _v$14 = theme().textMuted,
        _v$15 = theme().textMuted,
        _v$16 = theme().textMuted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$6, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$7, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$1, "backgroundColor", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$11, "fg", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp(_el$15, "fg", _v$7, _p$.s));
      _v$8 !== _p$.h && (_p$.h = _$setProp(_el$16, "fg", _v$8, _p$.h));
      _v$9 !== _p$.r && (_p$.r = _$setProp(_el$17, "fg", _v$9, _p$.r));
      _v$0 !== _p$.d && (_p$.d = _$setProp(_el$20, "fg", _v$0, _p$.d));
      _v$1 !== _p$.l && (_p$.l = _$setProp(_el$22, "fg", _v$1, _p$.l));
      _v$10 !== _p$.u && (_p$.u = _$setProp(_el$24, "fg", _v$10, _p$.u));
      _v$11 !== _p$.c && (_p$.c = _$setProp(_el$26, "fg", _v$11, _p$.c));
      _v$12 !== _p$.w && (_p$.w = _$setProp(_el$28, "fg", _v$12, _p$.w));
      _v$13 !== _p$.m && (_p$.m = _$setProp(_el$30, "fg", _v$13, _p$.m));
      _v$14 !== _p$.f && (_p$.f = _$setProp(_el$37, "fg", _v$14, _p$.f));
      _v$15 !== _p$.y && (_p$.y = _$setProp(_el$39, "fg", _v$15, _p$.y));
      _v$16 !== _p$.g && (_p$.g = _$setProp(_el$41, "fg", _v$16, _p$.g));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined,
      c: undefined,
      w: undefined,
      m: undefined,
      f: undefined,
      y: undefined,
      g: undefined
    });
    return _el$;
  })();
}
export function DetailReturn(props) {
  createEffect(() => {
    const route = props.api.route.current;
    if (route.name !== 'session') return;
    for (const message of props.api.state.session.messages(route.params.sessionID)) {
      for (const part of props.api.state.part(message.id)) void props.hideTransport(part);
    }
  });
  return _$createComponent(Show, {
    get when() {
      return props.active();
    },
    get children() {
      var _el$49 = _$createElement("box"),
        _el$50 = _$createElement("text"),
        _el$52 = _$createElement("text");
      _$insertNode(_el$49, _el$50);
      _$insertNode(_el$49, _el$52);
      _$setProp(_el$49, "flexDirection", "row");
      _$setProp(_el$49, "paddingLeft", 2);
      _$setProp(_el$49, "paddingRight", 2);
      _$setProp(_el$49, "height", 1);
      _$insertNode(_el$50, _$createTextNode(`↑ 返回 DAG 看板`));
      _$insertNode(_el$52, _$createTextNode(` 按上方向键或点击这里`));
      _$effect(_p$ => {
        var _v$23 = props.api.theme.current.backgroundPanel,
          _v$24 = props.back,
          _v$25 = props.api.theme.current.primary,
          _v$26 = props.api.theme.current.textMuted;
        _v$23 !== _p$.e && (_p$.e = _$setProp(_el$49, "backgroundColor", _v$23, _p$.e));
        _v$24 !== _p$.t && (_p$.t = _$setProp(_el$49, "onMouseUp", _v$24, _p$.t));
        _v$25 !== _p$.a && (_p$.a = _$setProp(_el$50, "fg", _v$25, _p$.a));
        _v$26 !== _p$.o && (_p$.o = _$setProp(_el$52, "fg", _v$26, _p$.o));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined
      });
      return _el$49;
    }
  });
}
