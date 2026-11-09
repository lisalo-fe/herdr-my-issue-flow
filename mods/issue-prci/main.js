// PR / CI: the pull request of the shown worktree (its review state and CI checks, failing
// ones by name), then my other open PRs. Read-only `gh` calls with the account gh is
// logged in as; nothing is written to GitHub. Clicking a PR or a failing check opens it
// in the browser; → shows that PR's worktree space when one is open.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme, spaces, panes, run } from "herdr";
import { header, dot, pill, tone, tint, link, ago, SPINNER } from "./ui.js";

const POLL = 120000;
const FIELDS = "number,title,headRefName,url,isDraft,state,reviewDecision,statusCheckRollup";
const FAIL = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const REVIEW = { APPROVED: ["已核准", "ok"], CHANGES_REQUESTED: ["要求修改", "error"], REVIEW_REQUIRED: ["待審", "info"] };

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || "";
}

// CI: failing checks by name, how many are still running, how many passed.
function ci(rollup) {
  const out = { fail: [], pending: 0, pass: 0 };
  for (const c of rollup ?? []) {
    const st = c.__typename === "CheckRun" ? (c.status !== "COMPLETED" ? "PENDING" : c.conclusion) : c.state;
    if (FAIL.has(st)) out.fail.push({ name: (c.name ?? c.context ?? "check").replace(/^continuous-integration\//, ""), url: c.detailsUrl ?? c.targetUrl });
    else if (PASS.has(st)) out.pass++;
    else out.pending++;
  }
  out.word = out.fail.length ? "error" : out.pending ? "busy" : out.pass ? "ok" : "idle";
  return out;
}

const openUrl = (url) => { if (/^https:\/\//.test(url ?? "")) exec("/usr/bin/open", [url]); };
const ticket = (s) => s?.match(/FOOTBALL-\d+/i)?.[0]?.toUpperCase() ?? null;

export default class PrCi extends View {
  init(_props, cx) {
    this.repoDefault = `${home()}/football-fe-web-mvc`;
    this.list = null; // my open PRs in the shown repo
    this.extra = {}; // branch -> PR found with `gh pr view` (not mine / not open), or false
    this.error = null;
    this.at = 0;
    this.cwd = null;
    this.branch = undefined;
    this.load(cx);
    cx.timer.every(POLL, (cx) => this.load(cx));
    // The shown worktree changed: look again (cheap when its PR is already in the list).
    cx.timer.every(1500, (cx) => {
      const { cwd, branch } = this.where();
      if (cwd !== this.cwd || branch !== this.branch) this.load(cx);
    });
  }

  where() {
    const shown = spaces().find((s) => s.active);
    return { cwd: shown ? place(shown, panes()) : "", branch: shown?.branch ?? null };
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    const { cwd, branch } = this.where();
    const moved = cwd !== this.cwd;
    this.cwd = cwd; this.branch = branch;
    cx.spawn(async (cx) => {
      try {
        // gh needs a folder in a GitHub repo: the shown worktree, else the main repo.
        let dir = this.repoDefault, inRepo = false;
        if (cwd) {
          const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 5000 }).catch(() => null);
          if (r?.code === 0) { dir = r.stdout.trim(); inRepo = true; }
        }
        this.inRepo = inRepo;
        if (moved || !this.list || Date.now() - this.at > POLL - 5000 || dir !== this.dir) {
          const r = await exec("gh", ["pr", "list", "--author", "@me", "--state", "open", "--limit", "10", "--json", FIELDS], { cwd: dir, timeout: 30000 });
          if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || `gh exit ${r.code}`);
          this.list = JSON.parse(r.stdout);
          this.dir = dir;
          this.at = Date.now();
          this.extra = {};
        }
        if (inRepo && branch && !["main", "master", "HEAD"].includes(branch) && !this.list.some((p) => p.headRefName === branch) && !(branch in this.extra)) {
          const r = await exec("gh", ["pr", "view", branch, "--json", FIELDS], { cwd: dir, timeout: 30000 });
          this.extra[branch] = r.code === 0 ? JSON.parse(r.stdout) : false;
        }
        this.error = null;
      } catch (e) { this.error = String(e.message ?? e); }
      this.loading = false;
      cx.notify();
    });
  }

  ciLine(t, c) {
    const parts = [];
    if (c.fail.length) parts.push([`✗ ${c.fail.length} 失敗`, tone(t, "error")]);
    if (c.pending) parts.push([`${c.pending} 執行中`, tone(t, "busy")]);
    if (c.pass) parts.push([`✓ ${c.pass} 通過`, c.fail.length ? t.muted : tone(t, "ok")]);
    if (!parts.length) parts.push(["沒有 CI 結果", t.dim]);
    return h_flex().gap(8).items_center().text_size(11.5)
      .when(c.pending > 0, (el) => el.child(svg(SPINNER).size(11).text_color(tone(t, "busy")).spin(900)))
      .children(parts.map(([s, c2], i) => div().id(`ci-${i}`).text_color(c2).child(s)));
  }

  // The shown worktree's PR, as a card.
  current(t) {
    const branch = this.branch;
    const muted = (s) => div().px(10).py(8).rounded(8).bg("#ffffff06").text_size(12).text_color(t.dim).child(s);
    if (!this.cwd || !this.inRepo) return muted("這個 space 不在 git repo");
    if (!branch || ["main", "master", "HEAD"].includes(branch)) return muted(`${branch ?? "detached"} · 沒有對應的 PR`);
    const pr = this.list?.find((p) => p.headRefName === branch) ?? this.extra[branch];
    if (pr === undefined) return muted(`${branch} · 讀取中…`);
    if (!pr) return v_flex().px(10).py(8).gap(2).rounded(8).bg("#ffffff06")
      .child(div().text_size(12).text_color(t.muted).truncate().child(branch))
      .child(div().text_size(11.5).text_color(t.dim).child("還沒有 PR"));
    const c = ci(pr.statusCheckRollup);
    const review = REVIEW[pr.reviewDecision];
    const state = pr.state === "MERGED" ? ["Merged", "ok"] : pr.state === "CLOSED" ? ["Closed", "idle"] : null;
    return v_flex().id("current").relative().pl(12).pr(10).py(8).gap(5).rounded(8).bg(tint(t.accent, "14"))
      .child(div().absolute().left(0).top(8).bottom(8).w(2).rounded(1).bg(t.accent))
      .child(h_flex().gap(6).items_center()
        .child(div().id("pr-num").font_family("JetBrains Mono").text_size(12).font_medium().text_color(t.foreground).cursor_pointer()
          .hover((s) => s.text_color(t.accent)).on_click(() => openUrl(pr.url)).child(`#${pr.number}`))
        .when(pr.isDraft, (el) => el.child(div().px(5).h(16).flex().items_center().rounded(4).bg("#ffffff0d").text_size(10.5).text_color(t.muted).child("Draft")))
        .when(Boolean(state), (el) => el.child(pill(t, state[0], state[1])))
        .when(!state && Boolean(review), (el) => el.child(div().text_size(11.5).text_color(tone(t, review[1])).child(review[0])))
        .child(div().flex_1())
        .child(dot(tone(t, c.word), 7)))
      .child(div().id("pr-title").text_size(12).text_color(t.foreground).line_height(1.35).cursor_pointer()
        .hover((s) => s.text_color(t.accent)).on_click(() => openUrl(pr.url)).child(pr.title))
      .child(this.ciLine(t, c))
      .children(c.fail.slice(0, 4).map((f, i) => h_flex().id(`fail-${i}`).gap(6).items_center().text_size(11.5).text_color(tone(t, "error"))
        .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => openUrl(f.url))
        .child(div().flex_1().min_w(0).truncate().child(`✗ ${f.name}`)).child(div().flex_none().text_color(t.dim).child("↗"))));
  }

  row(t, pr, i, sp) {
    const c = ci(pr.statusCheckRollup);
    const space = sp.find((s) => s.branch === pr.headRefName);
    const key = ticket(pr.headRefName) ?? ticket(pr.title);
    const title = key ? pr.title.replace(new RegExp(`^${key}[:\\s-]*`, "i"), "").replace(/^FE - WAP - /, "") : pr.title;
    return h_flex().id(`pr-${i}`).h(28).px(6).gap(7).items_center().rounded(6).hover((s) => s.bg(t.hover)).cursor_pointer()
      .tooltip(`${pr.title}\n${pr.headRefName}`)
      .on_click(() => openUrl(pr.url))
      .child(c.word === "busy" ? svg(SPINNER).size(10).flex_none().text_color(tone(t, "busy")).spin(900) : dot(tone(t, c.word), 6))
      .child(div().flex_none().font_family("JetBrains Mono").text_size(11).text_color(t.muted).child(`#${pr.number}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(pr.isDraft ? t.muted : t.foreground).child(title))
      .when(Boolean(space), (el) => el.child(div().id(`go-${i}`).flex_none().px(4).rounded(4).text_size(12).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("切到這個 worktree")
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: space.id }); }).child("→")));
  }

  render() {
    const t = theme();
    const sp = spaces();
    const others = (this.list ?? []).filter((p) => p.headRefName !== this.branch);
    const right = h_flex().gap(8).items_center()
      .when(Boolean(this.at), (el) => el.child(div().text_size(11).text_color(t.dim).child(ago(this.at))))
      .child(this.loading ? svg(SPINNER).size(11).text_color(t.dim).spin(900) : link(t, "reload", "↻", (_e, cx) => { this.at = 0; this.load(cx); }));
    return v_flex().id("root").size_full().min_h(0).px(12).pt(10).pb(8).gap(8)
      .child(header(t, "PR / CI", right))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(tone(t, "warn")).child(`gh：${this.error}`)))
      .child(this.current(t))
      .child(div().text_size(11).text_color(t.dim).pt(2).child(this.list ? `我的其他 open PR（${others.length}）` : ""))
      .child(v_flex().id("pr-list").flex_1().min_h(0).mx(-6).gap(1).overflow_y_scrollbar()
        .children(others.map((pr, i) => this.row(t, pr, i, sp))));
  }
}
