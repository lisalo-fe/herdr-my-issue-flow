#!/bin/bash
# Read-only status of football-fe-dev-proxy's local nginx, for the issue-nginx mod.
# Never uses sudo, never signals a process. Prints key=value lines.
#
#   nginx-status.sh <proxy dir>
#
# Only the nginx master started by this repo counts: its command line must name both
# the repo (-p <dir>) and its config (-c <dir>/nginx.local.conf), the same rule
# scripts/stop-local-nginx.sh uses, so Homebrew's own nginx service is never reported.
set -u
ROOT="${1:?usage: nginx-status.sh <proxy dir>}"
CONF="$ROOT/nginx.local.conf"
PID_FILE="$ROOT/run/nginx/nginx.pid"
ENV_LOCAL="$ROOT/.env.local"

is_master() {
  local cmd
  cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 1
  case "$cmd" in *"nginx: master process"*) ;; *) return 1 ;; esac
  case "$cmd" in *"$CONF"*) ;; *) return 1 ;; esac
  case "$cmd" in *"$ROOT"*) return 0 ;; esac
  return 1
}

pid=""
stale=0
if [ -r "$PID_FILE" ]; then
  p=$(tr -dc '0-9' < "$PID_FILE")
  if [ -n "$p" ] && is_master "$p"; then pid=$p; else stale=1; fi
fi
if [ -z "$pid" ]; then
  # The root-owned pid file can go missing while the master keeps running.
  p=$(ps -axo pid=,command= 2>/dev/null | awk -v r="$ROOT" -v c="$CONF" '/nginx: master process/ && index($0, r) && index($0, c) { print $1; exit }')
  if [ -n "$p" ] && is_master "$p"; then pid=$p; stale=0; fi
fi

if [ -n "$pid" ]; then
  echo "state=running"
  echo "pid=$pid"
  echo "etime=$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')"
  echo "workers=$(pgrep -P "$pid" 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "state=stopped"
fi
echo "stale_pid=$stale"

# Does anything answer on the ports nginx.local.conf listens on? (No privileges needed.)
port_open() { /usr/bin/nc -z -G 1 127.0.0.1 "$1" >/dev/null 2>&1 && echo 1 || echo 0; }
echo "https=$(port_open 443)"
echo "http=$(port_open 80)"

# An nginx-up / nginx-down already running (from a shell or another window).
if pgrep -f "$ROOT/scripts/(start|stop)-local-nginx\.sh" >/dev/null 2>&1; then echo "busy=1"; else echo "busy=0"; fi

# VPN DNS: what .env.local holds, what the generated resolver uses, what macOS uses now
# (the same detection as scripts/setup-dns.sh).
env_dns=$(grep -E '^VPN_DNS=' "$ENV_LOCAL" 2>/dev/null | tail -1 | cut -d= -f2-)
res_dns=$(awk '/^resolver /{print $2; exit}' "$ROOT/run/nginx/dns-resolver.conf" 2>/dev/null)
sys_dns=$(scutil --dns 2>/dev/null | grep 'nameserver\[[0-9]*\]' | head -n 1 | awk '{print $3}')
echo "dns_env=$env_dns"
echo "dns_resolver=$res_dns"
echo "dns_system=$sys_dns"

# Upstreams start-local-nginx.sh warns about.
pid_cmd() { [ -f "$1" ] && ps -p "$(cat "$1" 2>/dev/null)" -o command= 2>/dev/null | grep -q "$2" && echo 1 || echo 0; }
echo "ftl=$(pid_cmd "$ROOT/run/ftl-proxy/ftl-proxy.pid" fe-ftl-proxy)"
echo "dev_service=$(pid_cmd "$ROOT/run/dev-service/dev-service.pid" dev-service/server.js)"
