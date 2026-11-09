// My Issue Flow spaces: a repository tree.
//   repository (git common dir)            ▾ football-fe-web-mvc   ● 1 需要你   3
//     main checkout  → its branch            ⌂ master
//     each worktree  → its folder + branch   ⑂ FOOTBALL-14972   ↑2
//   spaces in no git repo                  ▾ 不在 git repo
//     named by Claude's own session title, else the program they run, plus their folder
// Every row shows its agents' state (working spinner, needs-you / done dot) without a click;
// a collapsed group still shows how many need you. Clicking a row shows that space, which
// opens its last-used tab. Repo and branch come only from git; nothing is guessed.
//
// Where a space is: the folder its Claude session was started in (Claude Code's statusLine
// workspace.project_dir, saved per terminal by ccsl-wrap), else its first terminal's live
// folder, else the folder it was made in. Cloned from Herdr's `spaces` mod (git checks,
// watching, menus); the tree and the agent state are My Issue Flow's.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, exec, theme, watchFolder, window, layout, home, readTextFile } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const FALLBACK = 60000; // git looked at again this often while the window is in front
const AGENT_POLL = 4000;
const FRESH = 30; // s: a statusLine save older than this is not trusted
const URGENCY = { blocked: 3, done: 2, working: 1, idle: 0 };

export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}
export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, top, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {};
    this.unsure = new Set();
    this.pending = new Set();
    this.busy = {};
    this.at = {};
    this.watching = new Set();
    this.agent = {}; // terminal -> { dir, name } from that terminal's live Claude session
    this.folded = new Set(JSON.parse(localStorage.getItem("groups.folded") ?? "[]"));
    cx.timer.every(250, (cx) => this.checkNew(cx));
    this.readAgents(cx);
    cx.timer.every(AGENT_POLL, (cx) => this.readAgents(cx));
  }

  // Claude sessions per terminal: their working dir and their own title (statusLine JSON).
  readAgents(cx) {
    if (this.readingAgents) return;
    this.readingAgents = true;
    cx.spawn(async (cx) => {
      const dir = `${home()}/.claude/herdr-sidebar/sessions`;
      const now = Date.now() / 1000;
      const next = {};
      for (const p of panes()) {
        if (!p.terminal || p.terminal.includes("/")) continue; // this machine only
        try {
          const term = JSON.parse((await readTextFile(`${dir}/term-${p.terminal}.json`)) ?? "null");
          if (!term?.session_id || now - term.at > FRESH) continue;
          const st = JSON.parse((await readTextFile(`${dir}/${term.session_id}.status.json`)) ?? "null");
          if (st?.session_id !== term.session_id || now - st.at > FRESH) continue;
          // project_dir: where the session was started. Stable, unlike current_dir, which
          // follows every `cd` the agent's shell makes and would make the row jump around.
          const ws = st.status?.workspace ?? {};
          next[p.terminal] = { dir: ws.project_dir ?? ws.current_dir ?? null, name: st.status?.session_name ?? null };
        } catch {}
      }
      const changed = JSON.stringify(next) !== JSON.stringify(this.agent);
      this.agent = next;
      this.readingAgents = false;
      if (changed) cx.notify();
    });
  }

  // A space's panes in tab order. The first tab decides where the space is (as Herdr's own
  // spaces mod does), so switching tabs inside a space never moves its row in the tree.
  panesOf(s, ps) {
    const order = (s.tabs ?? []).map((c) => c.id);
    return ps.filter((p) => order.includes(p.tab)).sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab));
  }

  place(s, ps) {
    const mine = this.panesOf(s, ps);
    for (const p of mine) if (p.terminal && this.agent[p.terminal]?.dir) return this.agent[p.terminal].dir;
    return mine.find((p) => p.cwd)?.cwd || s.folder || "";
  }

  where(s, ps) {
    return JSON.stringify([s.machine ?? null, this.place(s, ps)]);
  }

  checkNew(cx) {
    const due = this.due(Date.now(), spaces(), panes());
    if (due.size) this.refreshGit(due, cx);
  }

  // Places whose git could have changed: new ones, where a command or an agent's turn just
  // ended, and repos in view whose fallback is due.
  due(now, sp, ps) {
    const at = {};
    for (const s of sp) at[s.id] = this.where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    if (window().active) {
      for (const k of keys) {
        if ((this.git[k] || this.unsure.has(k)) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: its top-level, branch, ahead/behind and repository (common dir).
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      const top = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on })).stdout.trim();
      const repo = (await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on })).stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, top, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // How a space is called: its own name if someone named it; in a repo, the worktree folder
  // (or the main checkout's branch); elsewhere the Claude session's title or its program.
  label(s, g, ps) {
    if (s.named) return { text: s.name };
    if (g) return g.linked ? { text: base(g.top) } : { text: g.branch ?? "detached", main: true };
    const mine = this.panesOf(s, ps);
    for (const p of mine) if (p.terminal && this.agent[p.terminal]?.name) return { text: this.agent[p.terminal].name };
    const p = mine.find((x) => x.program?.agent) ?? mine[0];
    return { text: p?.program?.name ?? s.name };
  }

  // The spaces as groups: one per repository (in the order spaces come), then the rest.
  tree(ps) {
    const groups = new Map();
    for (const s of spaces()) {
      const key = this.where(s, ps);
      const g = this.git[key];
      const id = g ? `${g.repo}` : `none:${s.machine ?? ""}`;
      if (!groups.has(id)) groups.set(id, { id, name: g ? g.name : "不在 git repo", repo: Boolean(g), machine: s.machine ?? null, rows: [] });
      groups.get(id).rows.push({ s, g, key, place: this.place(s, ps) });
    }
    const list = [...groups.values()];
    // Main checkout first, then worktrees by name.
    for (const grp of list) grp.rows.sort((a, b) => (a.g?.linked ? 1 : 0) - (b.g?.linked ? 1 : 0));
    return [...list.filter((g) => g.repo), ...list.filter((g) => !g.repo)];
  }

  status(t, status, size = 7) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    if (status === "blocked" || status === "done") return div().size(size).flex_none().rounded_full().bg(t[status]);
    return div().size(size).flex_none();
  }

  header(grp, t, counts) {
    const folded = this.folded.has(grp.id);
    const worst = Object.keys(URGENCY).find((k) => counts[k] > 0 && k !== "idle");
    return h_flex().id(`group-${grp.id}`).h(28).flex_none().px(8).gap(7).items_center().rounded(6)
      .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        folded ? this.folded.delete(grp.id) : this.folded.add(grp.id);
        localStorage.setItem("groups.folded", JSON.stringify([...this.folded]));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(svg(`mods/workspace-chrome/${grp.repo ? "folder" : "monitor"}.svg`).size(13).flex_none().text_color(grp.repo ? t.muted : t.dim))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(grp.repo ? t.foreground : t.muted)
        .child(grp.machine ? `${grp.name} @ ${grp.machine}` : grp.name))
      .when(counts.blocked > 0, (el) => el.child(h_flex().flex_none().h(18).px(6).gap(4).items_center().rounded(9)
        .bg(`${t.blocked}26`).text_size(11).font_medium().text_color(t.blocked)
        .child(div().size(6).rounded_full().bg(t.blocked)).child(`${counts.blocked} 需要你`)))
      .when(folded && !counts.blocked && Boolean(worst), (el) => el.child(this.status(t, worst, 6)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(grp.rows.length)));
  }

  row({ s, g, place }, t, ps, inRepo) {
    const on = s.active;
    const { text, main } = this.label(s, g, ps);
    const mine = agents().filter((a) => a.space === s.id);
    const blocked = mine.filter((a) => a.status === "blocked").length;
    const branch = g && g.linked && g.branch && g.branch.toLowerCase() !== text.toLowerCase() ? g.branch : "";
    const folder = !g ? (place === home() ? "~" : place ? base(place) : "") : "";
    return h_flex().id(`space-${s.id}`).relative().h(30).flex_none().pl(inRepo ? 26 : 14).pr(8).gap(8).items_center().rounded(7)
      .when(on, (el) => el.bg(t.selected).child(div().absolute().left(0).top(7).bottom(7).w(2).rounded(1).bg(t.accent)))
      .when(!on, (el) => el.hover((st) => st.bg(t.hover)))
      .cursor_pointer()
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () => this.menu(s))
      .child(this.status(t, s.status))
      .when(Boolean(g), (el) => el.child(svg(`mods/workspace-chrome/${g.linked ? "branch" : "folder"}.svg`).size(12).flex_none().text_color(on ? t.accent : t.dim)))
      .child(div().flex_shrink(0).max_w(150).truncate().text_size(13).text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_medium()).child(text))
      .child(h_flex().flex_1().min_w(0).gap(5).justify_end().items_center().text_size(11.5).text_color(t.dim)
        .when(Boolean(branch || folder), (el) => el.child(div().min_w(0).truncate().child(branch || folder)))
        .when(Boolean(g?.ahead), (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
        .when(Boolean(g?.behind), (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)))
        .when(blocked > 0, (el) => el.child(div().flex_none().text_color(t.blocked).font_medium().child("需要你")))
        .when(mine.length > 1, (el) => el.child(div().flex_none().child(`${mine.length} agents`))));
  }

  compact(s, i, t) {
    return railCell(h_flex().id(`space-${s.id}`).relative().w(RAIL_CELL).h(26).rounded(6).justify_center().items_center()
      .when(s.active, (el) => el.bg(t.selected))
      .when(!s.active, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click(() => run("space.select", { id: s.id }))
      .child(div().text_color(s.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, s.status)).child(glyph(s.status))));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const ps = panes();
    const list = collapsed
      ? spaces().map((s, i) => this.compact(s, i, t))
      : this.tree(ps).flatMap((grp) => {
        const counts = { blocked: 0, done: 0, working: 0, idle: 0 };
        for (const { s } of grp.rows) {
          for (const a of agents().filter((a) => a.space === s.id)) counts[a.status] = (counts[a.status] ?? 0) + 1;
        }
        const head = this.header(grp, t, counts);
        return this.folded.has(grp.id) ? [head] : [head, ...grp.rows.map((r) => this.row(r, t, ps, true))];
      });
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, (el) => el.pl(0).pr(0).justify_center())
        .when(!collapsed, (el) => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("space-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).gap(1).overflow_y_scrollbar()
        .children(list));
  }
}
