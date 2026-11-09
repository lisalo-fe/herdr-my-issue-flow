// The look shared by the My Issue Flow side panels (issue-ai-usage, issue-nginx,
// issue-dev-servers, issue-prci). Each mod keeps an identical copy: mods load
// modules from their own folder only. Edit one, then copy it to the others.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

export const MONO = "JetBrains Mono";
export const SPINNER = "mods/workspace-chrome/spinner.svg";

// Tones: calm by default; `error` (the theme's blocked red) only for what needs action.
export function tone(t, name) {
  return {
    ok: t.ansi2,          // running, passing
    busy: t.accent,       // starting, pending, in progress
    warn: t.ansi3,        // worth a look, not broken
    error: t.blocked,     // actionable failure
    idle: t.dim,          // stopped, nothing there
    info: t.muted,
  }[name] ?? t.muted;
}

// Panel title row: "Local Nginx" on the left, something small on the right.
export function header(t, title, right) {
  return h_flex().h(20).flex_none().items_center().justify_between().gap(8)
    .child(div().text_size(11.5).font_medium().text_color(t.muted).child(title))
    .when(right != null, (el) => el.child(right));
}

// "#rrggbb" + alpha hex; colors that already carry alpha stay as they are.
export function tint(color, alpha) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

export function dot(color, size = 7) {
  return div().size(size).flex_none().rounded_full().bg(color);
}

// A status pill: dot (or spinner) + word, tinted by tone.
export function pill(t, label, toneName, spinning = false) {
  const c = tone(t, toneName);
  return h_flex().h(20).px(7).gap(5).flex_none().items_center().rounded(5).bg(tint(c, "1f"))
    .text_size(11.5).font_medium().text_color(c)
    .child(spinning ? svg(SPINNER).size(11).text_color(c).spin(900) : dot(c, 6))
    .child(label);
}

// A compact button. `disabled` draws it dimmed and drops the click.
export function button(t, id, { label, icon, onClick, disabled = false, tip }) {
  let el = h_flex().id(id).h(24).px(9).gap(5).flex_none().items_center().justify_center().rounded(6)
    .text_size(12).bg("#ffffff0b").text_color(disabled ? t.dim : t.foreground);
  if (icon) el = el.child(svg(icon).size(12).text_color(disabled ? t.dim : t.muted));
  el = el.child(label);
  if (tip) el = el.tooltip(tip);
  if (disabled) return el.opacity(0.55);
  return el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(onClick);
}

// A text link-ish control (expand output, dismiss).
export function link(t, id, label, onClick, color) {
  return div().id(id).flex_none().text_size(11.5).text_color(color ?? t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground)).on_click(onClick).child(label);
}

// "3:05:12" / "1-02:03:04" (ps etime) -> "3h05m", "1d2h", "12m".
export function age(etime) {
  if (!etime) return "";
  const [d, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = rest.split(":").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.unshift(0);
  const [h, m] = parts, days = parseInt(d, 10) || 0;
  if (days) return `${days}d${h}h`;
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

// ms epoch -> "14:05"
export function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "剛剛" / "3 分鐘前" / "2 小時前"
export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "剛剛";
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return `${Math.floor(s / 86400)} 天前`;
}
