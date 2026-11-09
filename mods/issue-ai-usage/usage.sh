#!/bin/bash
# Local AI usage for the issue-ai-usage mod. Reads files only: no network, no credentials.
#   Claude: rate_limits from Claude Code's own statusLine JSON, as ccsl-wrap saves it per
#           session (~/.claude/herdr-sidebar/sessions/*.status.json, the newest one), so it
#           keeps working with ccstatusline turned off. Fallback: ccstatusline's cache
#           ~/.cache/ccstatusline/usage.json (tokenHash is dropped, never reaches the mod).
#   Codex:  the newest rate_limits event in ~/.codex/sessions/**/rollout-*.jsonl.
# Prints one JSON object: { claude: {...} | null, codex: {...} | null }.
set -u
mtime() { stat -f %m "$1" 2>/dev/null || echo 0; }

claude=null
# Every session carries the rate limits it saw on its own last request, so an idle one lags.
# Within the current window (the latest resets_at) usage only grows: take the highest.
recent=$(find "$HOME/.claude/herdr-sidebar/sessions" -name '*.status.json' -mmin -15 2>/dev/null)
if [ -n "$recent" ]; then
  c=$(printf '%s\n' "$recent" | tr '\n' '\0' | xargs -0 jq -cs '
    [.[] | select(.status.rate_limits.five_hour.used_percentage != null)] as $s
    | if ($s | length) == 0 then empty else
      def win(k): ($s | map(.status.rate_limits[k]) | map(select(.resets_at != null))) as $w
        | ($w | max_by(.resets_at).resets_at) as $end
        | ($w | map(select(.resets_at == $end)) | max_by(.used_percentage));
      win("five_hour") as $h | win("seven_day") as $d
      | {session: $h.used_percentage, sessionResetAt: ($h.resets_at | todate),
         weekly: $d.used_percentage, weeklyResetAt: ($d.resets_at | todate),
         at: ($s | map(.at) | max), source: "statusline"} end' 2>/dev/null)
  [ -n "$c" ] && claude=$c
fi
f="$HOME/.cache/ccstatusline/usage.json"
if [ "$claude" = null ] && [ -r "$f" ]; then
  claude=$(jq -c --argjson at "$(mtime "$f")" \
    '{session: .sessionUsage, sessionResetAt: .sessionResetAt, weekly: .weeklyUsage, weeklyResetAt: .weeklyResetAt, at: $at, source: "ccstatusline"}' "$f" 2>/dev/null || echo null)
fi

codex=null
if [ -d "$HOME/.codex/sessions" ]; then
  for f in $(find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -type f -mtime -8 2>/dev/null | xargs ls -t 2>/dev/null | head -5); do
    line=$(tail -n 400 "$f" | grep '"rate_limits"' | tail -1)
    [ -n "$line" ] || continue
    codex=$(printf '%s' "$line" | jq -c --argjson at "$(mtime "$f")" \
      '[.. | objects | select(has("rate_limits")) | .rate_limits] | last
       | {primary: .primary, secondary: .secondary, at: $at}' 2>/dev/null || echo null)
    break
  done
fi
printf '{"claude":%s,"codex":%s}\n' "${claude:-null}" "${codex:-null}"
