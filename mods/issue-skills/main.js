// Skills: buttons for the skills used most, under PR / CI in My Issue Flow's right sidebar.
// A click types "/<skill> " into the Claude Code session being worked in (the focused terminal,
// else the last focused Claude terminal) and gives that terminal the keyboard. It never
// presses Enter: add arguments if needed, then send it yourself. While that session is
// waiting on a permission dialog the buttons are off, so typing can't answer the dialog.
// The list lives in skills.json next to this file (edit it; the panel reloads).
//
// props: { block?: this block's layout id, so the panel sizes the block to its rows }

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { hc, exec, theme, focused, agents, run, readTextFile, appHome, props } from "herdr";
import { header, tint } from "./ui.js";

const ROW = 26, GAP = 6;
const isClaude = (a) => a && (a.program?.key === "claude" || a.app === "claude-code");

// hc keys takes key names: characters as themselves, a space as "space".
const keysFor = (text) => [...text].map((ch) => (ch === " " ? "space" : ch));

// $1: the text. Exit 3: clipboard empty / not text (don't touch it); 4: paste failed.
const PASTE = `
text=$1
old=$(pbpaste 2>/dev/null; printf x); old=\${old%x}
[ -n "$old" ] || exit 3
printf %s "$text" | pbcopy
herdr-app do terminal.paste >/dev/null 2>&1 || { printf %s "$old" | pbcopy; exit 4; }
sleep 0.4
printf %s "$old" | pbcopy
`;

export default class Skills extends View {
  init(_props, cx) {
    this.skills = [];
    this.error = null;
    this.target = null; // last Claude terminal that had the keyboard
    this.note = null;
    this.lastHeight = null;
    cx.spawn(async (cx) => {
      try {
        const raw = await readTextFile(`${appHome()}/mods/issue-skills/skills.json`);
        this.skills = (JSON.parse(raw ?? "{}").skills ?? []).filter((s) => /^[a-z0-9:_-]+$/.test(s.command ?? ""));
      } catch (e) { this.error = `skills.json 讀不到：${e.message ?? e}`; }
      cx.notify();
    });
  }

  // The Claude session to type into: the focused terminal if it runs Claude, else the last one.
  claude() {
    const t = focused()?.terminal ?? focused()?.agent;
    const list = agents();
    if (t && isClaude(list.find((a) => a.address === t))) this.target = t;
    const a = this.target ? list.find((x) => x.address === this.target) : null;
    if (!isClaude(a)) { this.target = null; return null; }
    return a;
  }

  // Fast path: focus the session, paste the whole command at once through the clipboard and
  // put the person's clipboard back 0.4 s later (it stays inside that one shell, never on disk).
  // An empty or non-text clipboard (an image, which pbpaste can't give back) is left alone and
  // the command is typed key by key instead (hc keys, ~30 ms a key). Never presses Enter.
  send(skill, cx) {
    const a = this.claude();
    if (!a || a.status === "blocked") return;
    const text = `/${skill.command} `;
    run("pane.focus", { terminal: a.address });
    this.note = { text: `輸入 /${skill.command}…`, ok: true, at: Date.now() };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Only ever type where the person will see it: the target must have the keyboard first.
        for (let i = 0; i < 10 && focused()?.terminal !== a.address; i++) await cx.sleep(30);
        if (focused()?.terminal !== a.address) throw new Error("沒能切到那個 Claude 終端機，沒有輸入");
        const r = await exec("/bin/bash", ["-c", PASTE, "issue-skills", text], { timeout: 5000 });
        if (r.code !== 0) {
          const k = await hc(["keys", a.address, ...keysFor(text), "--json"]);
          if (k.code !== 0) throw new Error(k.stderr.trim() || k.stdout.trim() || `exit ${k.code}`);
        }
        this.note = { text: `已輸入 /${skill.command}，補參數後按 Enter`, ok: true, at: Date.now() };
      } catch (e) { this.note = { text: `輸入失敗：${e.message ?? e}`, ok: false, at: Date.now() }; }
      cx.notify();
      await cx.sleep(5000);
      if (this.note && Date.now() - this.note.at >= 4900) { this.note = null; cx.notify(); }
    });
  }

  // Grow or shrink the layout block to the rows (only when that changes).
  fit(px) {
    const id = props()?.block;
    if (!id || this.lastHeight === px) return;
    this.lastHeight = px;
    run("layout.resize", { id, px });
  }

  render() {
    const t = theme();
    const a = this.claude();
    const blocked = a?.status === "blocked";
    const off = !a || blocked;
    const where = a ? [a.space_name, a.tab_name].filter(Boolean).join(" · ") : "";
    const rows = Math.max(1, Math.ceil(this.skills.length / 2));
    const status = this.error ?? this.note?.text
      ?? (!a ? "先點一個 Claude Code 終端機" : blocked ? "這個 session 在等你回應對話框" : `→ ${where || a.address}`);
    this.fit(10 + 20 + GAP + rows * ROW + (rows - 1) * GAP + GAP + 16 + 10);
    const btn = (s, i) => {
      let el = h_flex().id(`skill-${i}`).flex_1().min_w(0).h(ROW).px(9).gap(6).items_center().rounded(6)
        .bg("#ffffff0b").text_size(12.5).tooltip(`/${s.command}${s.tip ? `\n${s.tip}` : ""}`)
        .child(div().flex_none().text_size(11).text_color(off ? t.dim : t.accent).child("/"))
        .child(div().min_w(0).truncate().text_color(off ? t.dim : t.foreground).child(s.label ?? s.command));
      if (off) return el.opacity(0.6);
      return el.cursor_pointer().hover((st) => st.bg(tint(t.accent, "26")))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => this.send(s, cx));
    };
    const grid = [];
    for (let i = 0; i < this.skills.length; i += 2) {
      grid.push(h_flex().w_full().min_w(0).gap(GAP)
        .child(btn(this.skills[i], i))
        .child(this.skills[i + 1] ? btn(this.skills[i + 1], i + 1) : div().flex_1()));
    }
    return v_flex().id("root").size_full().min_w(0).overflow_hidden().px(12).pt(10).pb(10).gap(GAP)
      .child(header(t, "Skills", null))
      .children(grid.length ? grid : [div().h(ROW).text_size(12).text_color(t.dim).child("skills.json 沒有項目")])
      .child(div().h(16).min_w(0).truncate().text_size(11)
        .text_color(this.error || (this.note && !this.note.ok) ? t.blocked : this.note ? t.ansi2 : blocked ? t.ansi3 : t.dim)
        .child(status));
  }
}
