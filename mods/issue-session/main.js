// Agent Session Footer: the focused terminal's Claude Code session, under the main pane.
//   row 1: model · context % · thinking effort          (session title, terminal)
//   row 2: ❯ last question (≈15 字) · ↳ recap → next step (≈30 字)
//
// Data is matched by session identity, never by repo or branch:
//   ~/.claude/herdr-sidebar/sessions/term-<terminal>.json  which session that terminal runs
//                                                           (ccsl-wrap, from Claude's statusLine)
//   sessions/<session_id>.status.json   Claude Code's statusLine JSON for that session
//   sessions/<session_id>.json          last question / recap / next (herdr-cc-hook; its recap is
//                                        the hook's existing Haiku call, nothing new here)
// Anything missing, stale, or from another session shows N/A instead of old data.
//
// props: { recap?: false } — without herdr-cc-hook there is no question / recap to show:
// row 2 is left out (give the block 34px instead of 62px).

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, theme, focused, panes, agents, readTextFile, props } from "herdr";
import { tone, tint, MONO } from "./ui.js";

const POLL = 1500;
const FRESH = 20; // s: statusLine refreshes every 2 s while Claude runs

// Width-aware clip: a CJK character counts 1, ASCII 0.5.
function clip(text, units) {
  let used = 0, out = "";
  for (const ch of text) {
    const w = /[\u0000-ÿ]/.test(ch) ? 0.5 : 1;
    if (used + w > units) return out.trimEnd() + "…";
    used += w; out += ch;
  }
  return out;
}
function clean(text) {
  return (text ?? "")
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, " [貼上內容] ")
    .replace(/\s+/g, " ").trim();
}
async function readJson(path) {
  try { const s = await readTextFile(path); return s ? JSON.parse(s) : null; } catch { return null; }
}
const isClaude = (p) => p && (p.program?.key === "claude" || p.app === "claude-code");

export default class AgentSession extends View {
  init(_props, cx) {
    this.dir = `${home()}/.claude/herdr-sidebar/sessions`;
    this.terminal = null; // last focused terminal (kept while a panel has the keyboard)
    this.data = null; // { terminal, sid, status, turn, at }
    this.load(cx);
    cx.timer.every(POLL, (cx) => this.load(cx));
  }

  // The terminal to follow: the focused one, else the agent an agent block shows, else the last one.
  target() {
    const f = focused();
    const t = f?.terminal ?? f?.agent ?? null;
    if (t) this.terminal = t;
    return this.terminal;
  }

  load(cx) {
    const terminal = this.target();
    if (!terminal || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      const now = Date.now() / 1000;
      const term = await readJson(`${this.dir}/term-${terminal}.json`);
      let data = { terminal, sid: null, status: null, turn: null, reason: "這個終端機沒有 Claude session 資料" };
      if (term?.session_id) {
        const sid = term.session_id;
        const [status, turn] = await Promise.all([readJson(`${this.dir}/${sid}.status.json`), readJson(`${this.dir}/${sid}.json`)]);
        const fresh = now - (term.at ?? 0) < FRESH && status?.session_id === sid && now - (status.at ?? 0) < FRESH;
        data = {
          terminal, sid,
          status: fresh ? status.status : null,
          turn: turn?.session_id === sid ? turn : null,
          reason: fresh ? null : "session 資料已過期（Claude 沒在跑？）",
        };
      }
      this.data = data;
      this.loading = false;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const terminal = this.target();
    // A focus change shows the right terminal at once; the next tick fills it in.
    const d = this.data?.terminal === terminal ? this.data : null;
    const pane = panes().find((p) => p.terminal === terminal);
    const agent = agents().find((a) => a.address === terminal);
    const program = agent?.program ?? pane?.program;
    const claude = isClaude(agent) || isClaude(pane);
    const s = claude ? d?.status : null;
    const turn = claude && s ? d?.turn : null;
    const na = (text = "N/A") => div().text_size(12).text_color(t.dim).child(text);

    const icon = program?.icon
      ? (program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14))
      : div().size(14);
    const ctx = s?.context_window?.used_percentage;
    const ctxTone = ctx == null ? t.dim : ctx >= 85 ? tone(t, "error") : ctx >= 70 ? tone(t, "warn") : t.accent;
    const effort = s?.effort?.level ?? (s ? null : null);
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);

    const row1 = h_flex().h(20).gap(14).items_center().min_w(0)
      .child(h_flex().gap(7).items_center().flex_none()
        .child(icon)
        .child(s ? div().text_size(12.5).font_medium().text_color(t.foreground).child(s.model?.display_name ?? "N/A")
          : div().text_size(12.5).text_color(t.muted).child(claude ? "Claude Code" : program?.name ?? "沒有聚焦的終端機")))
      .child(h_flex().gap(6).items_center().flex_none()
        .child(label("Context"))
        .child(div().w(64).h(5).rounded(3).bg("#ffffff10")
          .child(div().h_full().rounded(3).bg(tint(ctxTone, "d0")).w(`${Math.max(0, Math.min(100, ctx ?? 0))}%`)))
        .child(ctx == null ? na() : div().text_size(12).text_color(ctx >= 70 ? ctxTone : t.foreground).child(`${Math.round(ctx)}%`)))
      .child(h_flex().gap(6).items_center().flex_none()
        .child(label("Effort"))
        .child(effort ? div().text_size(12).text_color(t.foreground).child(effort) : na()))
      .child(div().flex_1())
      .child(div().min_w(0).truncate().text_size(11).text_color(t.dim)
        .child([s?.session_name, terminal].filter(Boolean).join(" · ") || (d?.reason ?? "")));

    let row2;
    if (!claude) {
      row2 = div().text_size(12).text_color(t.dim).child(terminal ? "這個終端機不是 Claude Code session：Question / Recap N/A" : "點一個終端機，這裡會顯示它的 session");
    } else if (!s) {
      row2 = div().text_size(12).text_color(t.dim).child(`Question / Recap N/A · ${d?.reason ?? "讀取中…"}`);
    } else {
      const q = clean(turn?.prompt);
      const recap = clean(turn?.recap);
      const next = clean(turn?.next);
      const waiting = recap === "整理中…";
      // Question (light blue) and answer (light green) each fill half the row and truncate at
      // its edge. The next step isn't drawn; hovering the answer shows it with the full recap.
      const text = (value, color) => div().min_w(0).truncate().text_size(13.5).font_medium().text_color(color).child(value);
      const half = (id, mark, color, body, tip) => h_flex().id(id).flex_1().min_w(0).gap(6).items_center()
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .child(div().flex_none().text_size(13).text_color(color).child(mark))
        .child(body);
      row2 = h_flex().h(22).gap(12).items_center().min_w(0)
        .child(half("question", "❯", t.ansi12, q ? text(q, t.ansi12) : na(), q ? clip(q, 300) : null))
        .child(div().w(1).h(14).flex_none().bg(t.border))
        .child(half("answer", "↳", t.ansi10,
          recap ? text(recap, waiting ? t.dim : t.ansi10) : na(turn ? "等這輪回答完" : "N/A"),
          recap && !waiting ? [recap, next && `→ ${next}`].filter(Boolean).join("\n") : null));
    }

    return v_flex().id("root").size_full().px(14).py(6).gap(4).justify_center().min_w(0)
      .child(row1)
      .when(props()?.recap !== false, (el) => el.child(row2));
  }
}
