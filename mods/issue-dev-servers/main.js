// Compact FE worktree controls. All probes are read-only; commands run only after a click.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, home, theme, spaces, panes, run, openOverlay, closeOverlay, props, shared, setShared } from "herdr";
import { MONO, header, dot, tone, tint, button, link } from "./ui.js";

const POLL = 15000;
const LOCK = "issue-dev.op";
const AUTH_TIMEOUT = 5 * 60 * 1000;
const COUNTRY = { 8001: "ng", 8002: "gh", 8003: "ke" };
const DISABLED_TIP = "不是 fe-up 起的，請在它的終端機停止";
const UP_SCRIPT = 'unset TMUX; exec </dev/null; echo "▶ fe-up $1 ($PWD)"; "$2" "$1"';
const inside = (path, root) => Boolean(path && root) && (path === root || path.startsWith(`${root}/`));
const labelOf = (repo) => repo?.split("/").filter(Boolean).pop() ?? "?";
const sessionOf = (repo) => repo === `${home()}/football-fe-web-mvc` ? "fe-main" : `fe-${labelOf(repo).replace(/[.:]/g, "_")}`;
const validRepo = (repo) => repo === `${home()}/football-fe-web-mvc` || inside(repo, `${home()}/football-fe-web-mvc-worktrees`);
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}
function reason(lines, code) {
  const line = [...lines].reverse().find((s) => /^(fe:|error|failed|fatal|sorry)/i.test(s.trim())) || [...lines].reverse().find((s) => s.trim());
  return line?.trim().slice(0, 180) || `指令結束（exit ${code ?? "?"}）`;
}

export default class DevServers extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "panel";
    if (this.role === "auth") return;
    this.rows = [];
    this.sessions = new Set();
    this.current = null;
    this.placeKey = null;
    this.env = ["ng", "gh", "ke"].includes(localStorage.getItem("env")) ? localStorage.getItem("env") : "ng";
    this.result = null;
    this.expanded = false;
    this.lastHeight = null;
    this.op = null;
    this.confirm = null;
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    const lock = shared(LOCK);
    if (lock?.terminal && Date.now() - lock.started < AUTH_TIMEOUT + 70000) {
      this.op = { ...lock, phase: "command" };
      cx.spawn(async (cx) => {
        try {
          const { code, lines } = await this.waitTerminal(this.op, cx);
          if (code !== 0) throw new Error(reason(lines, code));
          this.op.phase = "verify";
          const row = await this.verify(lock.repo, true, cx);
          this.result = { ok: true, text: `已啟動 :${row.port}`, lines: [] };
        } catch (e) { this.result = { ok: false, text: String(e.message ?? e), lines: [] }; }
        this.op = null;
        setShared(LOCK, null);
        this.refresh(cx);
        cx.notify();
      });
    } else if (lock && Date.now() - lock.started >= AUTH_TIMEOUT + 70000) setShared(LOCK, null);
  }

  async probe() {
    const rows = [];
    let serviceOk = false, listOk = false;
    try {
      const res = await exec("curl", ["-fsS", "--max-time", "3", "http://127.0.0.1:8787/api/nuxt-ports"], { timeout: 5000 });
      if (res.code !== 0) throw new Error(`curl exit ${res.code}`);
      const data = JSON.parse(res.stdout);
      for (const p of data.processes ?? []) {
        const repo = p.repository || p.workingDirectory || null;
        rows.push({ kind: "nuxt", port: Number(p.port), repo, label: labelOf(repo), branch: p.branch || "", pid: p.pid, revision: p.revision });
      }
      serviceOk = true;
    } catch {}
    try {
      const r = await exec(`${home()}/.local/bin/fe-ls`, ["--brief"], { timeout: 10000 });
      if (r.code !== 0) throw new Error(`fe-ls exit ${r.code}`);
      listOk = true;
      for (const part of r.stdout.trim().split(" · ").filter(Boolean)) {
        const [what, label] = part.trim().split(/\s+/, 2);
        const repo = label === "main" ? `${home()}/football-fe-web-mvc` : label && label !== "?" ? `${home()}/football-fe-web-mvc-worktrees/${label}` : null;
        if (/^\d+$/.test(what)) {
          const port = Number(what);
          if (!rows.some((row) => row.kind === "nuxt" && row.port === port)) rows.push({ kind: "nuxt", port, repo, label, branch: "" });
        } else if (what === "mvc" || what === "storybook") rows.push({ kind: what, port: what === "storybook" ? 6006 : null, repo, label, branch: "" });
      }
    } catch {}
    const sessions = new Set();
    try {
      const r = await exec("tmux", ["list-sessions", "-F", "#S"], { timeout: 5000 });
      for (const name of r.stdout.split("\n")) if (name.startsWith("fe-")) sessions.add(name.trim());
    } catch {}
    await Promise.all(rows.filter((r) => r.kind === "nuxt" && !COUNTRY[r.port] && r.pid).map(async (r) => {
      try {
        const out = await exec("ps", ["-o", "command=", "-p", String(r.pid)], { timeout: 3000 });
        r.env = out.stdout.match(/dev\.uat\.(ng|gh|ke)\b/)?.[1] || "uat";
      } catch { r.env = "uat"; }
    }));
    rows.sort((a, b) => (a.port ?? 99999) - (b.port ?? 99999));
    return { rows, sessions, observable: serviceOk || listOk };
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      try {
        const data = await this.probe();
        if (!data.observable) throw new Error("無法讀取 dev-service 或 fe-ls");
        this.rows = data.rows;
        this.sessions = data.sessions;
        this.probeError = null;
      } catch (e) { this.probeError = String(e.message ?? e); }
      this.refreshing = false;
      cx.notify();
    });
  }

  resolveCurrent(placeNow, cx) {
    if (placeNow === this.placeKey) return;
    this.placeKey = placeNow;
    this.current = null;
    if (!placeNow) return;
    cx.spawn(async (cx) => {
      let root = null;
      try {
        const r = await exec("git", ["-C", placeNow, "rev-parse", "--show-toplevel"], { timeout: 5000 });
        if (r.code === 0 && validRepo(r.stdout.trim())) root = r.stdout.trim();
      } catch {}
      if (this.placeKey === placeNow) { this.current = root; cx.notify(); }
    });
  }

  locked() {
    const lock = shared(LOCK);
    return Boolean(this.op || (lock && Date.now() - lock.started < AUTH_TIMEOUT + 70000));
  }

  height(px) {
    if (this.lastHeight === px || !props()?.block) return;
    this.lastHeight = px;
    run("layout.resize", { id: props().block, px });
  }

  showTerminal() {
    const op = this.op;
    if (!op?.terminal) return;
    op.overlay = openOverlay({ kind: "window", key: "issue-dev-auth", width: 660, height: 300,
      layout: { type: "column", children: [
        { type: "block", size: { px: 34 }, content: { mod: "issue-dev-servers", props: { role: "auth", terminal: op.terminal } } },
        { type: "block", content: { terminal: op.terminal } },
      ] },
    });
    try { run("pane.focus", { terminal: op.terminal }); } catch {}
  }

  async commandUp(repo, env, cx) {
    const op = this.op;
    const name = `issue-dev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name,
      "--cwd", repo, "--label", "issue-dev=op", "--", "/bin/bash", "-c", UP_SCRIPT,
      "issue-dev", env, `${home()}/.local/bin/fe-up`]);
    const address = JSON.parse(r.stdout || "{}").address;
    if (!address) throw new Error(r.stderr.trim() || "無法開啟終端機");
    op.terminal = address;
    op.started = Date.now();
    setShared(LOCK, { kind: op.kind, repo: op.repo, env: op.env, terminal: address, started: op.started });
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(3000);
      if (this.op === op && !op.ended) { this.showTerminal(); cx.notify(); }
    });
    return this.waitTerminal(op, cx);
  }

  async waitTerminal(op, cx) {
    let end = null;
    while (!end) {
      const r = await hc(["wait", op.terminal, "--json", "--timeout", "15"]);
      const w = JSON.parse(r.stdout || "{}");
      if (w.error?.kind === "not_found") { end = { code: null }; break; }
      if (w.ended) { end = { code: w.exit_code ?? null }; break; }
      if (Date.now() - op.started > AUTH_TIMEOUT) {
        await hc(["kill", op.terminal, "--json"]);
        op.timedOut = true;
      }
    }
    op.ended = true;
    let lines = [];
    try { const r = await hc(["read", op.terminal, "--lines", "400"]); lines = r.stdout.trimEnd().split("\n"); } catch {}
    try { await hc(["rm", op.terminal, "--json"]); } catch {}
    if (op.overlay) { try { closeOverlay(op.overlay); } catch {} op.overlay = null; }
    return { code: end.code, lines };
  }

  async commandDown(repo) {
    const name = sessionOf(repo);
    const check = await exec("tmux", ["has-session", "-t", `=${name}`], { timeout: 5000 });
    if (check.code !== 0) throw new Error(`${name} 已不存在`);
    const r = await exec(`${home()}/.local/bin/fe-down`, [name.slice(3)], { timeout: 60000 });
    return { code: r.code, lines: (r.stdout + "\n" + r.stderr).trim().split("\n") };
  }

  async verify(repo, wantRunning, cx) {
    for (let i = 0; i < 40; i++) {
      const data = await this.probe();
      if (!data.observable) throw new Error("無法確認 Nuxt port 狀態");
      this.rows = data.rows;
      this.sessions = data.sessions;
      const row = data.rows.find((r) => r.kind === "nuxt" && r.repo === repo);
      if (wantRunning ? Boolean(row?.port) : !row) { cx.notify(); return row; }
      await cx.sleep(1500);
    }
    throw new Error(wantRunning ? "60 秒內未偵測到 Nuxt listening port" : "Nuxt port 仍在執行");
  }

  perform(kind, repo, env, cx, other = null) {
    if (this.locked() || !validRepo(repo)) return;
    if (kind === "switch" && (this.sessions.has(sessionOf(repo)) || this.rows.some((r) => r.kind === "nuxt" && r.repo === repo))) return;
    this.confirm = null;
    this.result = null;
    this.expanded = false;
    this.op = { kind, repo, env, started: Date.now(), phase: "command" };
    setShared(LOCK, { kind, repo, env, started: this.op.started });
    cx.notify();
    cx.spawn(async (cx) => {
      let lines = [], code = 0;
      try {
        if (kind === "stop") {
          ({ lines, code } = await this.commandDown(repo));
          if (code !== 0) throw new Error(reason(lines, code));
          await this.verify(repo, false, cx);
          this.result = { ok: true, text: "已停止", lines: [] };
        } else {
          if (kind === "switch") {
            if (!other || !this.sessions.has(sessionOf(other))) throw new Error("原伺服器沒有 fe-up session");
            ({ lines, code } = await this.commandDown(other));
            if (code !== 0) throw new Error(reason(lines, code));
            await this.verify(other, false, cx);
          }
          ({ lines, code } = await this.commandUp(repo, env, cx));
          if (code !== 0) throw new Error(reason(lines, code));
          this.op.phase = "verify";
          cx.notify();
          const row = await this.verify(repo, true, cx);
          this.result = { ok: true, text: `已啟動 :${row.port}`, lines: [] };
        }
      } catch (e) {
        this.result = { ok: false, text: String(e.message ?? e), lines };
      } finally {
        if (this.op?.overlay) { try { closeOverlay(this.op.overlay); } catch {} }
        this.op = null;
        setShared(LOCK, null);
        this.refresh(cx);
        cx.notify();
      }
    });
  }

  confirmSwitch(row, cx) {
    if (this.locked() || !this.current) return;
    const key = `${row.repo}:${row.port}`;
    if (this.confirm?.key === key && Date.now() < this.confirm.until) {
      this.perform("switch", this.current, COUNTRY[row.port], cx, row.repo);
      return;
    }
    const until = Date.now() + 4000;
    this.confirm = { key, until };
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(4000);
      if (this.confirm?.key === key && this.confirm.until === until) { this.confirm = null; cx.notify(); }
    });
  }

  renderAuth() {
    const t = theme(), p = props();
    return h_flex().id("root").size_full().px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(12).text_color(t.foreground).child("啟動 Dev Server · sudo 授權"))
      .child(button(t, "cancel", { label: "取消", onClick: () => hc(["kill", p.terminal, "--json"]) }));
  }

  serverRow(t, row, i, current, target, locked) {
    const active = Boolean(current && row.repo === current);
    const session = row.repo && sessionOf(row.repo);
    const stoppable = Boolean(session && this.sessions.has(session));
    const currentBusy = Boolean(current && (this.sessions.has(sessionOf(current)) || this.rows.some((r) => r.kind === "nuxt" && r.repo === current)));
    const switchable = Boolean(!active && current && COUNTRY[row.port] && stoppable && !currentBusy);
    const key = `${row.repo}:${row.port}`;
    const confirming = this.confirm?.key === key && Date.now() < this.confirm.until;
    const env = COUNTRY[row.port] || row.env || (row.kind === "nuxt" ? "uat" : row.kind);
    const tip = [row.repo, row.branch, row.pid && `pid ${row.pid}`].filter(Boolean).join("\n");
    return h_flex().id(`server-${i}`).relative().w_full().min_w(0).h(row.branch ? 38 : 28).px(7).gap(6).items_center().rounded(5)
      .when(active, (el) => el.bg(tint(t.accent, "1c")).child(div().absolute().left(0).top(5).bottom(5).w(2).bg(t.accent)))
      .when(!active, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(target), (el) => el.cursor_pointer().on_click(() => run("space.select", { id: target.id })))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(dot(tone(t, "ok"), 6))
      .child(div().flex_none().font_family(MONO).text_size(11).text_color(t.foreground).child(row.port ? `:${row.port}` : row.kind))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(env))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12).text_color(t.foreground).child(row.label || labelOf(row.repo)))
        .when(Boolean(row.branch), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(row.branch))))
      .when(!active, (el) => el
        .child(button(t, `stop-${i}`, { label: "Stop", disabled: locked || !stoppable, tip: stoppable ? `fe-down ${session.slice(3)}` : DISABLED_TIP,
          onClick: (_e, cx) => { cx.stop_propagation(); this.perform("stop", row.repo, null, cx); } }))
        .when(Boolean(current && COUNTRY[row.port]), (el) => el.child(button(t, `switch-${i}`, {
          label: confirming ? "確認切換" : "Switch", disabled: locked || !switchable,
          tip: switchable ? `fe-down ${session.slice(3)} → fe-up ${COUNTRY[row.port]}` : DISABLED_TIP,
          onClick: (_e, cx) => { cx.stop_propagation(); this.confirmSwitch(row, cx); },
        }))));
  }

  render(cx) {
    if (this.role === "auth") return this.renderAuth();
    const t = theme(), sp = spaces(), ps = panes(), shown = sp.find((s) => s.active);
    const currentPlace = shown && !shown.machine ? place(shown, ps) : "";
    this.resolveCurrent(currentPlace, cx);
    const current = this.current, rows = this.rows, locked = this.locked();
    const mine = rows.filter((r) => r.repo === current && r.kind === "nuxt");
    const running = mine[0];
    const ownSession = current && this.sessions.has(sessionOf(current));
    const valid = Boolean(current);
    const result = this.result;
    const detail = result && !result.ok && result.lines?.length;
    // The current worktree's own server is already in the section above: list the others here.
    const others = rows.filter((r) => !(current && r.repo === current));
    const rowHeight = others.reduce((sum, r) => sum + (r.branch ? 38 : 28) + 2, 0);
    const outputHeight = this.expanded && detail ? 100 : 0;
    const childCount = 2 + Number(Boolean(others.length)) + Number(Boolean(this.op || result || this.probeError)) + Number(Boolean(outputHeight));
    const height = 10 + 8 + 20 + (valid ? 58 : 28) + (others.length ? 20 + rowHeight : 0)
      + (this.op || result || this.probeError ? 22 : 0) + outputHeight + 6 * (childCount - 1);
    this.height(height);
    // No background of its own: the layout block draws the rounded card.
    // Fill the block's width (long branch names truncate instead of widening the card).
    return v_flex().id("root").size_full().min_w(0).overflow_hidden().px(12).pt(10).pb(8).gap(6)
      .child(header(t, "Dev Servers", div().text_size(11).text_color(t.dim).child(rows.length ? `${rows.length} 個` : "")))
      .child(valid ? v_flex().h(58).w_full().min_w(0).gap(4)
        .child(h_flex().h(28).w_full().min_w(0).gap(6).items_center()
          .child(dot(tone(t, running ? "ok" : "idle"), 6))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(`${labelOf(current)} · ${running ? `:${running.port} ${COUNTRY[running.port] || running.env || "uat"}` : "未啟動"}`)))
        .child(h_flex().h(26).w_full().min_w(0).gap(4).items_center()
          .children(["ng", "gh", "ke"].map((env) => div().id(`env-${env}`).h(24).px(7).flex().items_center().rounded(5)
            .bg(this.env === env ? tint(t.accent, "28") : "#ffffff0b")
            .text_size(11).text_color(this.env === env ? t.accent : t.muted)
            .cursor_pointer().on_click((_e, cx) => { this.env = env; localStorage.setItem("env", env); cx.notify(); }).child(env)))
          .child(div().flex_1())
          .child(button(t, "start", { label: "Start", disabled: locked || Boolean(running) || Boolean(ownSession), tip: `fe-up ${this.env}`,
            onClick: (_e, cx) => this.perform("start", current, this.env, cx) }))
          .child(button(t, "stop-current", { label: "Stop", disabled: locked || !ownSession, tip: ownSession ? `fe-down ${sessionOf(current).slice(3)}` : DISABLED_TIP,
            onClick: (_e, cx) => this.perform("stop", current, null, cx) })))
        : div().h(28).flex().items_center().text_size(12).text_color(t.dim).child(currentPlace ? "目前 space 不是 football-fe worktree" : "目前沒有本機 football-fe worktree"))
      .when(Boolean(others.length), (el) => el.child(v_flex().w_full().min_w(0).gap(2)
        .child(div().h(20).flex().items_center().text_size(11).text_color(t.muted).child(current ? "其他 worktree 的伺服器" : "執行中的伺服器"))
        .children(others.map((r, i) => {
          const target = r.repo ? sp.find((s) => inside(place(s, ps), r.repo)) : null;
          return this.serverRow(t, r, i, current, target, locked);
        }))))
      .when(Boolean(this.op || result || this.probeError), (el) => el.child(h_flex().h(22).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(result && !result.ok ? tone(t, "error") : t.muted)
          .child(this.op ? (this.op.phase === "verify" ? "確認服務狀態…" : "操作中…") : result?.text || this.probeError))
        .when(Boolean(this.op?.terminal && !this.op?.ended), (el) => el.child(link(t, "show-terminal", "顯示終端機", () => this.showTerminal())))
        .when(Boolean(detail), (el) => el.child(link(t, "output-toggle", this.expanded ? "收合 ▴" : "輸出 ▾", (_e, cx) => { this.expanded = !this.expanded; cx.notify(); })))))
      .when(Boolean(outputHeight), (el) => el.child(v_flex().h(100).p(6).rounded(5).bg(t.background).overflow_y_scrollbar()
        .children(result.lines.slice(-80).map((line, i) => div().id(`line-${i}`).font_family(MONO).text_size(11).text_color(t.muted).child(line || " ")))));
  }
}
