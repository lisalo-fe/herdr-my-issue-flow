# My Issue Flow

Herdr app 的一個版面，給 football-fe 開單、改 code、上 UAT 這條流程用。

![My Issue Flow](preview.png)

- **左側**：Space 依 git repo 和 worktree 分組；每列都顯示 agent 狀態（處理中、需要你、完成）
- **上方分頁列**：右邊有 Files、Changes、Git 三個按鈕，Git 會在右側面板打開 [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) 的 commit 分支圖（像 VS Code 的 Graph）
- **中間**：上方是 Agent Session 列，顯示目前 Claude 的模型、context 用量、effort，以及上一個問題、結論和下一步；下面是終端機
- **右側**：AI 用量（Claude、Codex）、本機 Nginx、Dev Servers、PR / CI、常用 skill 按鈕

在 Herdr app 0.1.14 上做的，macOS。

## 裝之前要知道

- **Nginx、Dev Servers、PR / CI 面板假設 repo 放在 `~/football-fe-web-mvc`、`~/football-fe-dev-proxy`。** Dev Servers 還需要 `~/.local/bin/fe-up`、`fe-down`、`fe-ls`，這些指令都由 `extras/bin/fe-dev` 這一支腳本提供，安裝方式見下面的「Dev Servers 和 Nginx 的指令」。沒裝的話，Dev Servers 面板就不能啟動或停止 dev server；Nginx 面板會改跑 `football-fe-dev-proxy` 自己的 `scripts/`，照樣能用。
- **上方 session 列要有內容，得另外裝 `herdr-cc-hook` 和 `ccsl-wrap`，再自己改 `~/.claude/settings.json`。** `ccsl-wrap` 負責模型、context、effort 和 AI 用量，會取代你原本的 statusLine。`herdr-cc-hook` 負責問答簡述，每回合會多呼叫一次 Haiku 整理結論；也可以改成直接用回覆的第一句，就不花用量。用下面的 prompt 安裝時，可以勾掉問答簡述、Git Graph、Skills 這三項。詳見「選用：讓 Agent Session 列有內容」。
- **Git Graph 是別人寫的 mod，而且能改 git。** 它是 [rabeeh-ta/herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph)（MIT），不在這個 repo 裡，安裝時會從 GitHub 拿審查過的 v0.3.2（commit `2f4fe0f`），並關掉它的自動查新版。它不只是看圖：**雙擊分支標籤會直接 checkout**，右鍵選單的 reset、rebase、merge、push、刪遠端分支只隔一個對話框，按 Enter 就執行。在 football-fe 裡 commit、push 請用終端機：它沒有放寬 Herdr 的 30 秒時限，husky 的 pre-push 測試可能被中斷。
- **Skills 面板的按鈕要換成你自己的 skill。** 6 個按鈕裡，`merge-uat`、`gh-copilot-review`、`start-ticket` 是作者個人的 skill，你應該沒有。`author-wap-jira-ticket`、`git-workflows`、`check-cms` 在 football-fe-web-mvc 的 `.cursor/skills/` 裡，只要你的 Claude Code 有接上就能用。

## 讓 AI 幫你設定

在 Claude Code（或 Codex）裡打開 `~/herdr-my-issue-flow`，貼上下面這段。它會先問你**問答簡述、Git Graph、Skills 這三項要不要**，你勾掉的就完全不裝、不檢查。接著它會檢查你缺什麼、裝好剩下的功能，改設定檔之前也會先問你。

```text
你在 ~/herdr-my-issue-flow，這是 Herdr app 的「My Issue Flow」版面分享包。先讀 README.md 和 RECIPE.md，再幫我裝好、設定好。每一步做之前先告訴我要做什麼；改任何設定檔之前先備份。

0. 先問我哪些功能不需要。用可以複選的選單（Claude Code 用 AskUserQuestion）只列下面三項，每項附一句「它做什麼、要裝什麼、有什麼代價」，問我「哪些不需要」：
   - 問答簡述：Session 列第二行顯示上一個問題、結論、下一步。要裝 herdr-cc-hook。
   - Git Graph：上方分頁列的 Git 按鈕，在右側面板打開 commit 分支圖（像 VS Code 的 Graph）。用的是別人寫的 rabeeh-ta/herdr-git-graph，雙擊分支標籤會直接 checkout，右鍵可以 reset、push 等，要提醒我。
   - Skills：右側一排 skill 按鈕，按下去會把 /skill 打進 Claude 的輸入框。
   其他功能一律安裝，不用問：版面本身、Spaces / Agents、上方分頁、Session 列第一行（模型、context、effort）、AI Usage、Local Nginx、Dev Servers、PR / CI。
   我勾掉的功能，後面每一步都跳過：不檢查它的依賴、不裝它的檔案、也不再問。
   我保留問答簡述的話，再問一題：結論要用 Haiku 整理（每回合多呼叫一次 Haiku，算在我的 Claude 用量），還是直接用回覆的第一句（不花用量）。

1. 檢查環境，只檢查要裝的功能需要的東西，用表格回報哪些有、哪些缺：
   - Herdr app：`herdr-app --version`，以及 ~/.config/herdr-app/ 存在
   - repo：~/football-fe-web-mvc、~/football-fe-dev-proxy；worktree 資料夾 ~/football-fe-web-mvc-worktrees/
   - 指令：git、gh（跑 `gh auth status`）、tmux、lsof、node、pnpm、/usr/bin/jq，以及 ~/.local/bin/fe-up、fe-down、fe-ls
   - 保留問答簡述的話：python3、claude
   repo 放在別的地方的話，不要搬 repo：列出哪些 mod 的哪幾行寫死了路徑，問我要改 mod 還是建 symlink。

2. 安裝版面和 mod：
   - 複製 mods/ 裡的 issue-* mod，但我勾掉的不要複製（Skills 是 issue-skills）。~/.config/herdr-app/mods/ 裡已經存在的不要覆蓋。
   - 保留 Git Graph 的話，照 README「安裝」那段裡 Git Graph 的指令，裝 rabeeh-ta/herdr-git-graph 鎖定的 commit 2f4fe0fc22e7cc726f3c1a2a654887c96227c37b（不要裝最新版），資料夾名稱一定要是 git-graph，裝完把 update.js 的 `const CHECK = true;` 改成 false。
   - 把 layouts/my-issue-flow.json、my-issue-flow.svg 複製到 ~/.config/herdr-app/layouts/，然後只改複製過去的那份 layout，不要改 repo 裡的檔案：
     - 勾掉 Git Graph：刪掉 id 為 panel-body 的 stack 裡 id 為 graph 的那一頁（上方的 Git 按鈕會自己消失）
     - 勾掉 Skills：刪掉 id 為 flow-skills 的區塊
     - 勾掉問答簡述：id 為 session 的區塊，size 改成 {"px": 34}，content 加上 "props": {"recap": false}（只留第一行）
   - 每個複製過去的 mod 都跑 `herdr-app check`，全部通過才執行 `herdr-app do layout.switch '{"name":"my-issue-flow"}'`。切換後確認 ~/.config/herdr-app/ 沒有出現 layout.error。

3. fe-dev：缺 fe-up 這些指令的話，照 README「Dev Servers 和 Nginx 的指令」那段，用 extras/bin/fe-dev 安裝，不要自己另寫一份。~/.local/bin 裡已經有同名檔案的就跳過，並告訴我。~/.local/bin 不在 PATH 裡的話告訴我，不要自己改 shell 設定檔。

4. Session 列和問答簡述：
   - 一定要做：把 extras/bin/ccsl-wrap 複製到 ~/.local/bin 並加上執行權限，再把 ~/.claude/settings.json 的 statusLine 換成 extras/claude-settings.snippet.json 裡的那段。Session 列第一行和 AI Usage 的 Claude 用量都靠它。我原本就有 statusLine 的話，先給我看原本的內容，問我要不要換；我不換的話，告訴我這兩個地方會沒有資料。
   - 保留問答簡述才做：把 extras/bin/herdr-cc-hook 複製到 ~/.local/bin 並加上執行權限，再把 snippet 裡的 hooks 加進 settings.json 原本的 UserPromptSubmit、Stop 陣列，不要取代原本的 hook。我選「用回覆的第一句」的話，再執行 `mkdir -p ~/.claude/herdr-sidebar && touch ~/.claude/herdr-sidebar/no-llm`。
   - 改 settings.json 之前先備份，改完確認它還是合法的 JSON。你沒有權限改的話，把合併後要貼的完整內容給我，我自己貼。

5. Skills（保留才做）：列出我能用的 skill（~/.claude/skills、~/.claude/commands、~/football-fe-web-mvc/.cursor/skills），對照 ~/.config/herdr-app/mods/issue-skills/skills.json。把我沒有的按鈕換成我有的；先給我看新的清單，我同意才改。

不要做：不要跑 nginx-up、nginx-down、fe-up、fe-down 或任何需要 sudo 的指令；不要動 ~/.config/herdr-app 裡 issue-* 和 git-graph 以外的 mod 和 layout；不要執行 git-graph 裡的任何程式；不要 git push。

最後回報四件事：裝了哪些功能、跳過了哪些、哪些因為缺東西還不能用、我還要自己手動做什麼。
```

## 安裝

```bash
git clone git@github.com:lisalo-fe/herdr-my-issue-flow.git ~/herdr-my-issue-flow
cd ~/herdr-my-issue-flow

APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
# 不覆蓋：同名的已經存在就跳過，並印出來
for f in layouts/my-issue-flow.json layouts/my-issue-flow.svg mods/issue-*; do
  if [ -e "$APP/$f" ]; then echo "已存在，跳過：$APP/$f"; else cp -R "$f" "$APP/$f"; fi
done
for m in mods/issue-*; do herdr-app check "$APP/$m"; done

# Git Graph：rabeeh-ta/herdr-git-graph，鎖在審查過的 v0.3.2，關掉自動查新版
GG=2f4fe0fc22e7cc726f3c1a2a654887c96227c37b
tmp=$(mktemp -d)
git clone --quiet https://github.com/rabeeh-ta/herdr-git-graph.git "$tmp/gg" && git -C "$tmp/gg" checkout --quiet "$GG"
if [ -e "$APP/mods/git-graph" ]; then echo "已存在，跳過：$APP/mods/git-graph"; else
  cp -R "$tmp/gg/mods/git-graph" "$APP/mods/git-graph"
  sed -i '' 's/^const CHECK = true;$/const CHECK = false;/' "$APP/mods/git-graph/update.js"
fi
rm -rf "$tmp"
herdr-app check "$APP/mods/git-graph"

herdr-app do layout.switch '{"name":"my-issue-flow"}'
```

不想要 Git Graph 的話，跳過上面 Git Graph 那段，並把 `~/.config/herdr-app/layouts/my-issue-flow.json` 裡 `panel-body` 的 `graph` 那一頁刪掉；版面指到一個不存在的 mod 會出錯。上方的 Git 按鈕會跟著消失。

切回原本的版面：`cmd-shift-l`。萬一畫面壞掉，按 `ctrl-alt-shift-escape` 一定會回到預設的 `main` 版面。

### Dev Servers 和 Nginx 的指令

`fe-up`、`fe-down`、`fe-ls`、`nginx-up`、`nginx-down` 其實是同一支 `extras/bin/fe-dev`，它會看自己是用哪個名字被叫起來的，再決定要做什麼。安裝方式是複製一份，再建 5 個連結：

```bash
mkdir -p ~/.local/bin
cp extras/bin/fe-dev ~/.local/bin/fe-dev && chmod +x ~/.local/bin/fe-dev
for n in fe-up fe-down fe-ls nginx-up nginx-down; do
  if [ -e ~/.local/bin/$n ]; then echo "已存在，跳過：~/.local/bin/$n"; else ln -s ~/.local/bin/fe-dev ~/.local/bin/$n; fi
done
```

- 需要 tmux、lsof、pnpm，以及 `football-fe-dev-proxy` 裡的 `scripts/`。
- `nginx-up`、`nginx-down` 會用到 sudo。`fe-up` 發現 proxy 沒在跑時，會先跑 `dev-start.sh`，這一步也要 sudo。
- 也可以直接在終端機用：在 worktree 裡跑 `fe-up gh`，會開一個 tmux session 跑 Nuxt；`fe-down` 停掉它；`fe-ls` 列出哪些 dev port 被誰佔著。切換 VPN 之後要重跑 `nginx-up`。

### 更新

```bash
cd ~/herdr-my-issue-flow && git pull
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
cp layouts/my-issue-flow.json layouts/my-issue-flow.svg "$APP/layouts/"
rsync -a --exclude gpui-kit.d.ts --exclude jsconfig.json mods/ "$APP/mods/"
```

這會蓋掉你改過的 `mods/issue-*`，像是 `issue-skills/skills.json`。有改的話，先備份。

**安裝時有跳過功能的話，不要用上面的 `cp` 覆蓋 layout**，否則跳過的區塊會跑回來。請改跟 AI 說：「照 ~/.config/herdr-app/layouts/my-issue-flow.json 目前少掉的區塊，把 repo 的新版 layout 裁成一樣再裝」。

有裝 `fe-dev` 或兩支 session 列腳本的話，也要把新版從 `extras/bin/` 複製到 `~/.local/bin/`。

`git-graph` 不會跟著這個 repo 更新。它會停在鎖定的版本，自動查新版也是關的；要升級，請先審查新版的程式碼再換。

### 移除

把 `layouts/my-issue-flow.*`、`mods/issue-*` 和 `mods/git-graph` 從 `~/.config/herdr-app/` 刪掉。

## 選用：讓 Agent Session 列有內容

`issue-session`、`issue-spaces`、`issue-ai-usage` 會讀 `~/.claude/herdr-sidebar/sessions/`，這個資料夾由下面兩支腳本寫入。**不裝也能用**，只是 session 列會顯示 N/A，左側也看不到 Claude 的 session 標題。

| 腳本 | 掛在哪 | 做什麼 |
|---|---|---|
| `herdr-cc-hook` | Claude Code 的 `UserPromptSubmit`、`Stop` hook | 記下你問的問題；回合結束後在背景呼叫 `claude -p --model haiku`，把這輪整理成「結論 / 下一步」兩行 |
| `ccsl-wrap` | Claude Code 的 `statusLine` | 把模型、context、用量、專案資料夾存下來，大約每 2 秒一次 |

**裝之前要知道：**

- `herdr-cc-hook` **每回合會多呼叫一次 Haiku**，算在你自己的 Claude 用量裡。執行 `touch ~/.claude/herdr-sidebar/no-llm` 可以關掉，關掉後結論改用回覆的第一句。
- `ccsl-wrap` **會取代你原本的 statusLine**。在 Herdr app 裡它不顯示任何東西，因為資訊已經在上方的 session 列。在其他終端機，只有在你裝了 `~/.local/bin/ccstatusline`，而且有 `~/.claude/.statusline-on` 這個檔案時，才會跑 ccstatusline。
- 兩支腳本都只在 Herdr 的終端機裡動作；在其他地方開 Claude Code 不會受影響。
- 需要 `python3`、`claude` CLI，以及 `/usr/bin/jq`（macOS 15 以上內建）。

**安裝：**

```bash
mkdir -p ~/.local/bin
cp extras/bin/herdr-cc-hook extras/bin/ccsl-wrap ~/.local/bin/
chmod +x ~/.local/bin/herdr-cc-hook ~/.local/bin/ccsl-wrap
```

接著**自己**把 `extras/claude-settings.snippet.json` 合併進 `~/.claude/settings.json`：

- `hooks.UserPromptSubmit`、`hooks.Stop`：加進原本的陣列，不要取代
- `statusLine`：會取代原本的設定

已經開著的 Claude session 不用重開，就會吃到新的 hook。

## 每個面板需要什麼

| 面板 | 需要 |
|---|---|
| Local Nginx（`issue-nginx`） | `~/football-fe-dev-proxy`。有 `~/.local/bin/nginx-up`、`nginx-down`（`extras/bin/fe-dev`）就用它們；沒有的話，直接跑 proxy repo 的 `scripts/setup-dns.sh`、`start-local-nginx.sh`、`stop-local-nginx.sh`。啟動和停止需要 sudo，會開一個小視窗讓你按 Touch ID 或輸入密碼 |
| Dev Servers（`issue-dev-servers`） | `~/.local/bin/fe-up`、`fe-down`、`fe-ls`（`extras/bin/fe-dev`）、tmux、`127.0.0.1:8787` 的 dev proxy；worktree 放在 `~/football-fe-web-mvc-worktrees/` |
| PR / CI（`issue-prci`） | `gh` 已登入；repo 放在 `~/football-fe-web-mvc`。只讀不寫 |
| Skills（`issue-skills`） | 按鈕只會把 `/<skill> ` 打進 Claude 的輸入框，不會按 Enter。清單在 `mods/issue-skills/skills.json`，改完面板會自己重新載入。預設的 `merge-uat`、`gh-copilot-review`、`start-ticket` 是作者個人的 skill，請換成你自己的 |
| AI Usage（`issue-ai-usage`） | Claude 的用量來自 `ccsl-wrap` 存的資料，退而求其次讀 `~/.cache/ccstatusline/usage.json`；Codex 的用量讀 `~/.codex/sessions/`。只讀本機檔案，不連網路 |
| Agent Session（`issue-session`）、Spaces（`issue-spaces`） | 上面那兩支選用腳本。沒裝 `herdr-cc-hook` 時，在版面的 `session` 區塊加上 `"props": {"recap": false}`、高度改成 34px，就只顯示第一行 |
| Git（`git-graph`，上方 Git 按鈕） | git。rabeeh-ta 的 git-graph 放在右側面板的 `graph` 那一頁，`issue-tabs` 看到這一頁才會畫 Git 按鈕。它跟著目前聚焦的終端機所在的 repo，有 All branches / Current 切換、diff 檢視和右鍵 git 操作，**會改 git**，見「裝之前要知道」 |

路徑寫死在 mod 裡。你的 repo 放在別的地方的話，要改對應 mod 的 `main.js`。`issue-nginx` 可以用版面裡的 `props.dir` 指定 proxy repo 的位置。

## 自己做一份

`RECIPE.md` 是給 agent 看的建構說明。照著它，可以在空資料夾從頭重建這個版面，Herdr 版本不同、這裡的檔案跑不起來時用得到。
