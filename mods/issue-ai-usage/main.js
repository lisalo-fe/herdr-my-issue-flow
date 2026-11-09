// AI Usage: Claude Code and Codex rate-limit windows (5h and weekly), compact.
// Data comes from local files only (usage.sh): ccstatusline's usage cache and Codex's
// session logs. Nothing here reads a token or calls an API.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, appHome, theme } from "herdr";
import { header, tone, tint, clock, ago } from "./ui.js";

const POLL = 60000;
const DAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

// When a window resets, short: "15:40" today, "週二 23:00" this week.
function when(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(ms);
  if (ms - Date.now() < 6 * 86400000) return `${DAYS[d.getDay()]} ${clock(ms)}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default class AiUsage extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("/bin/bash", [`${appHome()}/mods/issue-ai-usage/usage.sh`], { timeout: 10000 });
        this.data = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
  }

  // One window: label, bar, percent, reset time. A window whose reset has passed shows as reset.
  bar(t, id, label, pct, resetMs) {
    const reset = resetMs && resetMs < Date.now();
    const p = reset || pct == null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
    const color = p >= 90 ? tone(t, "error") : p >= 75 ? tone(t, "warn") : t.accent;
    return h_flex().id(id).h(18).gap(8).items_center()
      .child(div().w(16).flex_none().text_size(11).text_color(t.dim).child(label))
      .child(div().flex_1().h(5).rounded(3).bg("#ffffff10")
        .child(div().h_full().rounded(3).bg(tint(color, "d0")).w(`${p}%`)))
      .child(div().w(34).flex_none().text_size(11.5).text_color(p >= 75 ? color : t.foreground).text_right().child(pct == null ? "—" : `${p}%`))
      .child(div().w(68).flex_none().text_size(11).text_color(t.dim).text_right().truncate().child(reset ? "已重置" : when(resetMs)));
  }

  // `at`: when the source file was last written (seconds). Old data isn't an error: the
  // windows still say when they reset, so it stays dim.
  group(t, name, rows, at) {
    return h_flex().gap(8).items_start()
      .child(v_flex().w(48).flex_none().pt(1)
        .child(div().text_size(12).font_medium().text_color(t.foreground).child(name))
        .when(Boolean(at), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(ago(at * 1000)))))
      .child(v_flex().flex_1().min_w(0).gap(2).children(rows));
  }

  // Cursor keeps no usage on disk; its quota lives behind Cursor's own API and login.
  // Until reading it is allowed, the row links to the usage dashboard instead.
  cursor(t) {
    return h_flex().id("cursor").h(20).gap(8).items_center()
      .child(div().w(48).flex_none().text_size(12).font_medium().text_color(t.foreground).child("Cursor"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child("未連線"))
      .child(div().id("cursor-open").flex_none().text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).tooltip("在瀏覽器開 cursor.com 用量頁")
        .on_click(() => exec("/usr/bin/open", ["https://cursor.com/dashboard?tab=usage"]))
        .child("用量頁 ↗"));
  }

  render() {
    const t = theme();
    const d = this.data;
    const body = [];
    if (d?.claude) {
      const c = d.claude;
      body.push(this.group(t, "Claude", [
        this.bar(t, "c5", "5h", c.session, Date.parse(c.sessionResetAt)),
        this.bar(t, "cw", "週", c.weekly, Date.parse(c.weeklyResetAt)),
      ], c.at));
    }
    if (d?.codex) {
      const x = d.codex;
      body.push(this.group(t, "Codex", [
        this.bar(t, "x5", "5h", x.primary?.used_percent, x.primary?.resets_at * 1000),
        this.bar(t, "xw", "週", x.secondary?.used_percent, x.secondary?.resets_at * 1000),
      ], x.at));
    }
    if (!body.length) body.push(div().text_size(12).text_color(t.dim).child(this.error ? `讀不到用量：${this.error}` : d ? "還沒有用量資料（開啟 Claude statusline 或跑一次 Codex）" : "讀取中…"));
    body.push(this.cursor(t));
    return v_flex().id("root").size_full().min_h(0).px(12).pt(10).pb(10).gap(8)
      .child(header(t, "AI Usage", null))
      .children(body);
  }
}
