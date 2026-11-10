// Agent Session header: the focused terminal's Claude Code, Cursor, or Codex session, under the tabs.
//   row 1: model · context % · thinking effort          (session title, terminal)
//   row 2: ❯ last question (≈15 字) · ↳ recap → next step (≈30 字)   Claude only
//
// Data is matched by session identity, never by repo or branch:
//   ~/.claude/herdr-sidebar/sessions/term-<terminal>.json  which session that terminal runs
//     Claude: ccsl-wrap. Cursor: herdr-cursor-status. Codex: herdr-codex-status.
//   sessions/<session_id>.status.json   that session's statusLine JSON
//   sessions/<session_id>.json          last question / recap / next (herdr-cc-hook, Claude only)
// Cursor has no effort.level. Its model.param_summary is the context size plus effort
// ("500K High"); the Effort slot reads the effort word, Context reads used_percentage.
// Codex keeps both in its rollout: last input tokens / model_context_window, and turn effort.
// Anything missing, stale, or from another session shows N/A instead of old data.
//
// props: { recap?: false } — without herdr-cc-hook there is no question / recap to show:
// row 2 is left out (give the block 34px instead of 62px).

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, focused, panes, agents, readTextFile, props } from "herdr";
import { tone, tint, MONO } from "./ui.js";

const POLL = 1500;
const FRESH = 20; // s: Claude's statusLine refreshes every 2 s while it runs
const HOLD_FRESH = 6 * 60 * 60; // Cursor and Codex refresh on conversation updates, not every 2 s

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
const isCursor = (p) => p && (p.program?.key === "cursor" || p.app === "cursor" || p.app === "cursor-agent");
const isCodex = (p) => p && (p.program?.key === "codex" || p.app === "codex");
// Cursor joins context size and effort into param_summary ("500K High", "Extra High").
function effortOf(s) {
  const level = s?.effort?.level;
  if (typeof level === "string" && level) return level;
  const summary = String(s?.model?.param_summary ?? "").replace(/extra high/ig, "xhigh");
  const hit = summary.split(/\s+/).find((w) => /^(low|medium|high|xhigh|max)$/i.test(w));
  return hit ? hit.toLowerCase() : null;
}
function modelLabel(s, cursor) {
  const name = s?.model?.display_name ?? "N/A";
  if (!cursor) return name;
  const summary = String(s?.model?.param_summary ?? "").trim();
  if (summary && name.endsWith(summary)) {
    const cut = name.slice(0, -summary.length).trim();
    if (cut) return cut;
  }
  return name;
}

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
      const pane = panes().find((p) => p.terminal === terminal);
      const agent = agents().find((a) => a.address === terminal);
      if (isCodex(agent) || isCodex(pane)) {
        try {
          await exec(`${home()}/.local/bin/herdr-codex-status`, ["--pane", terminal, "--cwd", pane?.cwd || ""], { timeout: 4000 });
        } catch {}
      }
      const term = await readJson(`${this.dir}/term-${terminal}.json`);
      let data = { terminal, sid: null, status: null, at: 0, turn: null, reason: "missing" };
      if (term?.session_id) {
        const sid = term.session_id;
        const [status, turn] = await Promise.all([readJson(`${this.dir}/${sid}.status.json`), readJson(`${this.dir}/${sid}.json`)]);
        const matched = status?.session_id === sid ? status : null;
        data = {
          terminal, sid,
          status: matched?.status ?? null,
          at: matched?.at ?? 0,
          turn: turn?.session_id === sid ? turn : null,
          reason: matched ? null : "mismatch",
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
    const cursor = !claude && (isCursor(agent) || isCursor(pane));
    const codex = !claude && !cursor && (isCodex(agent) || isCodex(pane));
    const kind = claude ? "claude" : cursor ? "cursor" : codex ? "codex" : null;
    const age = Date.now() / 1000 - (d?.at ?? 0);
    const s = kind && d?.status && age < (cursor || codex ? HOLD_FRESH : FRESH) ? d.status : null;
    const turn = claude && s ? d?.turn : null;
    const na = (text = "N/A") => div().text_size(12).text_color(t.dim).child(text);
    const why = !kind || s ? ""
      : d?.status ? (codex ? "Codex session 資料已過期" : cursor ? "Cursor session 資料已過期" : "session 資料已過期（Claude 沒在跑？）")
      : d?.reason === "mismatch" ? "session 資料對不上"
      : d?.reason === "missing" ? (codex ? "這個終端機沒有 Codex session 資料" : cursor ? "這個終端機沒有 Cursor session 資料" : claude ? "這個終端機沒有 Claude session 資料" : "")
      : "讀取中…";

    const icon = program?.icon
      ? (program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14))
      : div().size(14);
    const ctx = s?.context_window?.used_percentage;
    const ctxTone = ctx == null ? t.dim : ctx >= 85 ? tone(t, "error") : ctx >= 70 ? tone(t, "warn") : t.accent;
    const effort = s ? effortOf(s) : null;
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);

    const row1 = h_flex().h(20).gap(14).items_center().min_w(0)
      .child(h_flex().gap(7).items_center().flex_none()
        .child(icon)
        .child(s ? div().text_size(12.5).font_medium().text_color(t.foreground).child(modelLabel(s, cursor))
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
        .child([s?.session_name, terminal].filter(Boolean).join(" · ") || why));

    let row2;
    if (!kind) {
      row2 = div().text_size(12).text_color(t.dim).child(terminal ? "這個終端機不是 Claude Code session：Question / Recap N/A" : "點一個終端機，這裡會顯示它的 session");
    } else if (!s) {
      row2 = div().text_size(12).text_color(t.dim).child(`Question / Recap N/A · ${why}`);
    } else if (cursor || codex) {
      row2 = div().text_size(12).text_color(t.dim).child("Question / Recap N/A · 沒有問答簡述");
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
