// Local Nginx: the nginx of ~/football-fe-dev-proxy, always visible in My Issue Flow's
// right sidebar. It reads state without privileges (nginx-status.sh) and runs the
// repo's own commands for changes:
//   Start / Restart -> ~/.local/bin/nginx-up   (setup-dns.sh: VPN DNS -> .env.local, then
//                      start-local-nginx.sh: includes, `nginx -t`, start or HUP reload)
//   Stop            -> ~/.local/bin/nginx-down (stop-local-nginx.sh: QUIT, then TERM, KILL)
// Those use sudo, so they run in a real terminal (herdr-core, unlabeled: it belongs to no
// tab or space) shown in a small window, where sudo asks for Touch ID or the password
// itself. This mod never sees, stores or sends a credential. After the command ends the
// process state is checked again before anything is reported as done.
//
// props: { dir?: proxy repo (default ~/football-fe-dev-proxy), block?: this block's
// layout id (to grow it while output is open), height?, expanded? }
// The auth window draws a title bar from this same mod: props { role: "auth", terminal, op }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, home, appHome, theme, run, openOverlay, closeOverlay, props, shared, setShared } from "herdr";
import { MONO, header, pill, button, link, tone, age, clock } from "./ui.js";

const LOCK = "issue-nginx.op"; // shared { op, terminal, started }: one operation at a time, every copy
const AUTH_TIMEOUT = 5 * 60 * 1000; // nobody answered the sudo prompt: cancel
const POLL = 5000;
const WORDS = { start: "啟動", restart: "重新啟動", stop: "停止" };

// The terminal's script. $1: up|down, $2: the nginx-up / nginx-down executable. If that
// executable is gone, run what it runs (football-agents/bin/fe-dev cmd_nginx_up/down).
const SCRIPT = `
mode=$1; bin=$2
if [ -x "$bin" ]; then
  echo "▶ $(basename "$bin")   ($PWD)"; echo
  "$bin"; code=$?
elif [ "$mode" = up ]; then
  echo "▶ bash scripts/setup-dns.sh && bash scripts/start-local-nginx.sh   ($PWD)"; echo
  bash scripts/setup-dns.sh && bash scripts/start-local-nginx.sh; code=$?
else
  echo "▶ bash scripts/stop-local-nginx.sh   ($PWD)"; echo
  bash scripts/stop-local-nginx.sh; code=$?
fi
echo
if [ "$code" -eq 0 ]; then echo "✓ exit 0"; else echo "✗ exit $code"; fi
exit "$code"
`;

function parse(stdout) {
  const s = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) s[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return {
    running: s.state === "running",
    pid: s.pid || null,
    etime: s.etime || "",
    https: s.https === "1",
    http: s.http === "1",
    stale: s.stale_pid === "1",
    busy: s.busy === "1",
    dnsEnv: s.dns_env || "",
    dnsResolver: s.dns_resolver || "",
    dnsSystem: s.dns_system || "",
    ftl: s.ftl === "1",
    devService: s.dev_service === "1",
  };
}

// One line that says why it failed, from the command's output.
function reason(lines, code, signal) {
  const text = lines.join("\n");
  if (signal || code === null) return "已取消";
  if (/Sorry, try again|incorrect password|a password is required|no password was provided|authentication failure/i.test(text)) return "授權失敗：sudo 沒有通過";
  const emerg = lines.find((l) => /\[(emerg|alert|crit)\]/.test(l));
  if (emerg) return emerg.replace(/^.*?\[(emerg|alert|crit)\]\s*(\d+#\d+:\s*)?/, "設定錯誤：");
  if (/configuration file .* test failed/.test(text)) return "設定驗證失敗（nginx -t）";
  const err = lines.find((l) => /^ERROR:|^fe: /.test(l.trim()));
  if (err) return err.trim().replace(/^ERROR:\s*/, "");
  const last = [...lines].reverse().find((l) => l.trim() && !/^[✓✗] exit/.test(l.trim()));
  return last ? last.trim() : `exit ${code}`;
}

export default class LocalNginx extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "panel";
    if (this.role === "auth") return;
    this.dir = props()?.dir ?? `${home()}/football-fe-dev-proxy`;
    this.s = null; // last status
    this.probeError = null;
    this.op = null; // { kind, terminal, overlay, started, before, phase }
    this.result = null; // { kind, ok, text, lines, at }
    this.expanded = false;
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    // A reload or layout switch mid-operation: pick up the terminal that's still there.
    const lock = shared(LOCK);
    if (lock?.terminal && Date.now() - lock.started < AUTH_TIMEOUT + 60000) {
      this.op = { kind: lock.op, terminal: lock.terminal, started: lock.started, before: lock.before ?? null, phase: "auth" };
      cx.spawn(async (cx) => this.follow(cx));
    } else if (lock) setShared(LOCK, null);
  }

  async status() {
    const r = await exec("/bin/bash", [`${appHome()}/mods/issue-nginx/nginx-status.sh`, this.dir], { timeout: 10000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `status exit ${r.code}`);
    return parse(r.stdout);
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      try { this.s = await this.status(); this.probeError = null; }
      catch (e) { this.probeError = String(e.message ?? e); }
      this.refreshing = false;
      cx.notify();
    });
  }

  // Someone (this copy, another copy, a shell) is changing nginx right now.
  locked() {
    const lock = shared(LOCK);
    return Boolean(this.op) || Boolean(lock && Date.now() - lock.started < AUTH_TIMEOUT + 60000) || Boolean(this.s?.busy);
  }

  perform(kind, cx) {
    if (this.locked() || !this.s) return;
    const before = this.s.running ? this.s.pid : null;
    this.op = { kind, started: Date.now(), before, phase: "launch" };
    this.result = null;
    this.collapse();
    setShared(LOCK, { op: kind, terminal: null, started: this.op.started, before });
    cx.notify();
    cx.spawn(async (cx) => {
      const mode = kind === "stop" ? "down" : "up";
      const bin = `${home()}/.local/bin/nginx-${mode}`;
      const name = `issue-nginx-${kind}-${Date.now() % 1e9}`;
      let address = null;
      try {
        const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", this.dir,
          "--label", "issue-nginx=op", "--", "/bin/bash", "-c", SCRIPT, "issue-nginx", mode, bin]);
        address = JSON.parse(r.stdout || "{}").address ?? null;
        if (!address) throw new Error(r.stderr.trim() || r.stdout.trim() || "hc run failed");
      } catch (e) {
        this.finish({ ok: false, text: `無法開啟終端機：${String(e.message ?? e)}`, lines: [] }, cx);
        return;
      }
      this.op.terminal = address;
      this.op.phase = "auth";
      setShared(LOCK, { op: kind, terminal: address, started: this.op.started, before });
      this.showTerminal();
      cx.notify();
      await this.follow(cx);
    });
  }

  // The window with the live terminal: sudo's Touch ID / password prompt shows there.
  showTerminal() {
    const op = this.op;
    if (!op?.terminal) return;
    op.overlay = openOverlay({
      kind: "window", key: "issue-nginx-auth", width: 660, height: 300,
      layout: { type: "column", children: [
        { type: "block", size: { px: 34 }, content: { mod: "issue-nginx", props: { role: "auth", terminal: op.terminal, op: op.kind } } },
        { type: "block", content: { terminal: op.terminal } },
      ] },
    });
    // Type the password straight away: give the window's terminal the keyboard.
    try { run("pane.focus", { terminal: op.terminal }); } catch {}
  }

  // Wait for the terminal to end (or time out), read what it printed, then verify.
  async follow(cx) {
    const op = this.op;
    let end = null;
    while (!end) {
      let w = null;
      try {
        const r = await hc(["wait", op.terminal, "--json", "--timeout", "15"]);
        w = JSON.parse(r.stdout || "{}");
        if (w.error?.kind === "not_found") { end = { code: null, signal: null, gone: true }; break; }
      } catch { w = null; }
      if (w?.ended) { end = { code: w.exit_code ?? null, signal: w.signal ?? null }; break; }
      if (Date.now() - op.started > AUTH_TIMEOUT) {
        try { await hc(["kill", op.terminal, "--json"]); } catch {}
        op.timedOut = true;
      }
      cx.notify();
    }
    let lines = [];
    if (!end.gone) {
      try {
        const r = await hc(["read", op.terminal, "--lines", "400"]);
        lines = r.stdout.replace(/\s+$/, "").split("\n");
      } catch {}
      try { await hc(["rm", op.terminal, "--json"]); } catch {}
    }
    try { if (op.overlay) closeOverlay(op.overlay); } catch {}
    op.phase = "verify";
    cx.notify();

    // Never trust the exit code alone: look at the processes.
    const want = op.kind === "stop" ? (s) => !s.running : (s) => s.running && s.https;
    let s = null;
    for (let i = 0; i < 16; i++) {
      try { s = await this.status(); this.s = s; } catch {}
      if (s && want(s)) break;
      await cx.sleep(500);
    }
    const ok = end.code === 0 && s && want(s);
    let text;
    if (ok) {
      if (op.kind === "stop") text = "已停止，nginx 主程序已結束";
      else if (op.before && s.pid === op.before) text = `已重新載入設定（pid ${s.pid}）`;
      else text = `已啟動（pid ${s.pid}），:443 有回應`;
    } else if (op.timedOut) text = "等待授權逾時，已取消";
    else if (end.gone) text = "終端機已關閉，結果不明";
    else if (end.code === 0) text = op.kind === "stop" ? "指令結束，但 nginx 仍在執行" : "指令結束，但 nginx 沒有在 :443 回應";
    else text = reason(lines, end.code, end.signal);
    const cancelled = !ok && (end.signal || op.timedOut || end.code === null);
    this.finish({ ok, cancelled, text, lines }, cx);
  }

  finish(result, cx) {
    this.result = { kind: this.op?.kind, at: Date.now(), ...result };
    this.op = null;
    setShared(LOCK, null);
    this.refresh(cx);
    cx.notify();
  }

  expand() {
    this.expanded = true;
    const id = props()?.block;
    if (id) run("layout.resize", { id, px: props()?.expanded ?? 330 });
  }

  collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    const id = props()?.block;
    if (id) run("layout.resize", { id, px: props()?.height ?? 124 });
  }

  // What the pill says, from the operation first, then the processes.
  state() {
    const s = this.s, op = this.op ?? (shared(LOCK) ? { kind: shared(LOCK).op } : null);
    if (op) return op.kind === "stop" ? ["Stopping", "busy", true] : ["Starting", "busy", true];
    if (!s) return this.probeError ? ["Error", "error", false] : ["…", "idle", true];
    if (this.result && !this.result.ok && !this.result.cancelled) return ["Error", "error", false];
    if (s.busy) return [s.running ? "Running" : "Stopped", s.running ? "ok" : "idle", true];
    if (s.running && !s.https) return ["Error", "error", false];
    return s.running ? ["Running", "ok", false] : ["Stopped", "idle", false];
  }

  // The second line: facts about the process.
  facts(t) {
    const s = this.s;
    if (!s) return this.probeError ? `讀不到狀態：${this.probeError}` : "讀取狀態中…";
    const dns = s.dnsResolver || s.dnsEnv;
    if (s.running) return [`pid ${s.pid}`, age(s.etime) && `已執行 ${age(s.etime)}`, dns && `DNS ${dns}`].filter(Boolean).join(" · ");
    return ["未執行", s.stale && "pid 檔過期", dns && `DNS ${dns}`].filter(Boolean).join(" · ");
  }

  // The third line: what happened, or the one thing worth knowing. [text, tone]
  note() {
    const s = this.s, op = this.op;
    if (op) {
      if (op.phase === "launch") return ["開啟終端機…", "busy"];
      if (op.phase === "verify") return ["檢查 nginx 程序…", "busy"];
      return [`${WORDS[op.kind]}中：在終端機視窗用 Touch ID 或密碼授權`, "busy"];
    }
    if (shared(LOCK)) return ["另一個視窗正在操作 nginx", "busy"];
    if (s?.busy) return ["nginx-up / nginx-down 正在別處執行", "busy"];
    const r = this.result;
    if (r && !r.ok) return [`${WORDS[r.kind] ?? ""}失敗：${r.text}`, r.cancelled ? "info" : "error"];
    if (!s) return null;
    if (s.running && !s.https) return [":443 沒有回應，試試 Restart", "error"];
    if (!s.running && s.https) return [":443 已被其他程式佔用，Start 會失敗", "warn"];
    if (s.running && s.dnsSystem && s.dnsResolver && s.dnsSystem !== s.dnsResolver)
      return [`VPN DNS 已變成 ${s.dnsSystem}，Restart 套用`, "warn"];
    if (s.running && !s.ftl) return ["ftl-proxy 沒在跑，MVC 路由會失敗", "warn"];
    if (s.running && !s.devService) return ["dev-service 沒在跑，/api/hosts 會失敗", "warn"];
    if (r?.ok && Date.now() - r.at < 10 * 60 * 1000) return [`✓ ${r.text} · ${clock(r.at)}`, "ok"];
    return null;
  }

  renderAuth() {
    const t = theme(), p = props();
    const stop = (_e, cx) => cx.stop_propagation();
    return h_flex().id("root").size_full().px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .child(svg("mods/issue-nginx/lock.svg").size(13).text_color(t.accent))
      .child(div().font_medium().text_color(t.foreground).child(`Local Nginx · ${WORDS[p.op] ?? ""}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("sudo 需要授權：Touch ID，或點下方輸入密碼"))
      .child(div().id("auth-cancel").h(22).px(8).flex().items_center().rounded(5).bg("#ffffff0b").text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => { hc(["kill", p.terminal, "--json"]); })
        .child("取消"));
  }

  render() {
    if (this.role === "auth") return this.renderAuth();
    const t = theme();
    const s = this.s;
    const [word, toneName, spinning] = this.state();
    const locked = this.locked();
    const note = this.note();
    const failed = this.result && !this.result.ok && this.result.lines?.length;
    const primary = s && !s.running && !this.op
      ? { label: "Start", icon: "mods/issue-nginx/play.svg", kind: "start", tip: "nginx-up：偵測 VPN DNS、產生設定、nginx -t 驗證後啟動" }
      : { label: "Restart", icon: "mods/issue-nginx/restart.svg", kind: "restart", tip: "nginx-up：重新偵測 VPN DNS、產生設定、nginx -t 驗證後重新載入" };
    return v_flex().id("root").size_full().min_h(0).px(12).pt(10).pb(10).gap(6)
      .child(header(t, "Local Nginx", pill(t, word, toneName, spinning)))
      .child(div().text_size(12).text_color(t.muted).truncate().child(this.facts(t)))
      .child(h_flex().h(18).gap(8).items_center().min_w(0)
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(note ? tone(t, note[1]) : t.dim).child(note ? note[0] : ""))
        .when(Boolean(failed), (el) => el.child(link(t, "toggle-output", this.expanded ? "收合 ▴" : "輸出 ▾", (_e, cx) => { this.expanded ? this.collapse() : this.expand(); cx.notify(); })))
        .when(Boolean(this.result && !this.result.ok), (el) => el.child(link(t, "dismiss", "✕", (_e, cx) => { this.result = null; this.collapse(); cx.notify(); }))))
      .when(this.expanded && Boolean(failed), (el) => el.child(
        v_flex().id("output").flex_1().min_h(0).p(8).rounded(6).bg(t.background).border(1).border_color(t.border)
          .overflow_y_scrollbar().font_family(MONO).text_size(11).text_color(t.muted)
          .children(this.result.lines.slice(-200).map((line, i) => div().id(`l${i}`).whitespace_nowrap()
            .text_color(/\[(emerg|error|crit)\]|ERROR|Sorry|✗|failed/i.test(line) ? tone(t, "error") : t.muted)
            .child(line || " ")))))
      .child(h_flex().gap(6).items_center()
        .child(button(t, "primary", { label: primary.label, icon: primary.icon, disabled: locked || !s, tip: primary.tip, onClick: (_e, cx) => this.perform(primary.kind, cx) }))
        .child(button(t, "stop", { label: "Stop", icon: "mods/issue-nginx/stop.svg", disabled: locked || !s?.running, tip: "nginx-down：只停這個 repo 的 nginx", onClick: (_e, cx) => this.perform("stop", cx) }))
        .child(div().flex_1())
        .when(Boolean(this.op?.terminal && this.op.phase === "auth"), (el) => el.child(link(t, "show-terminal", "顯示終端機", () => this.showTerminal(), t.accent))));
  }
}
