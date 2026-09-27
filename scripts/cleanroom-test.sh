#!/usr/bin/env bash
# cleanroom-test.sh: run the documented install path on a machine that has never seen this
# project, and report what a new user would actually experience.
#
# Not meant to run on your own machine: the whole point is an environment with none of your
# setup. Run it in a throwaway container:
#
#   docker run --rm --memory=2g -v "$PWD/scripts/cleanroom-test.sh:/t.sh:ro" node:20-slim bash /t.sh
#
# It clones the public repo (not your working tree), so it tests what is actually published.
#
# Three real bugs were found the first time this ran, all invisible on a developer Mac:
#   * preflight called pgrep, absent from a minimal image
#   * preflight called `host` (bind9-host) and reported its absence as "DNS lookup failed ...
#     check internet connection", which sent people to debug a network that worked
#   * the stale-service age check used BSD `date -j`, so it silently did nothing on Linux
#
# Step 7 uses stub CLIs in place of codex/claude. It cannot test whether agents produce good
# work, but it does test the plumbing no Mac can reach: the detached-tmux monitor fallback.
set -uo pipefail

step() { printf '\n\033[1m### %s\033[0m\n' "$*"; }
ok()   { printf '  \033[92mOK\033[0m   %s\n' "$*"; }
bad()  { printf '  \033[91mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES+1)); }
FAILURES=0

step "0. Environment"
echo "  $(uname -a)"
echo "  node $(node --version), npm $(npm --version)"
apt-get update -qq > /dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git tmux python3 curl > /dev/null 2>&1
echo "  tmux $(tmux -V), python $(python3 --version | cut -d' ' -f2), git $(git --version | cut -d' ' -f3)"
for cli in claude codex grok agy; do
  command -v "$cli" > /dev/null 2>&1 && echo "  $cli: present (unexpected)" || echo "  $cli: absent, like any fresh machine"
done

step "1. git clone (the public repo, as documented)"
cd /root
if git clone -q https://github.com/michelhelsdingen/ensemble.git 2>/dev/null; then
  ok "clone succeeded"
else
  bad "clone failed"; exit 1
fi
cd /root/ensemble

step "2. npm install"
if npm install --no-fund --no-audit > /tmp/npm.log 2>&1; then
  ok "npm install succeeded ($(grep -c . /tmp/npm.log) log lines)"
else
  bad "npm install failed"; tail -20 /tmp/npm.log
fi

step "3. npm run dev + health endpoint"
npm run dev > /tmp/server.log 2>&1 &
for _ in $(seq 1 40); do
  curl -sf http://localhost:23000/api/v1/health > /dev/null 2>&1 && break
  sleep 1
done
HEALTH=$(curl -sf http://localhost:23000/api/v1/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  ok "health: $HEALTH"
else
  bad "health endpoint did not answer as documented (got: ${HEALTH:-nothing})"
  tail -15 /tmp/server.log
fi

step "4. npx ensemble status"
if npx ensemble status 2>&1 | tee /tmp/status.log | sed 's/^/  /'; then
  grep -qi "healthy" /tmp/status.log && ok "CLI reports the server" || bad "CLI output unexpected"
else
  bad "npx ensemble status failed"
fi

step "5. preflight with no agent CLI installed (what a new reader hits)"
OUT=$(./scripts/collab-preflight.sh codex 2>&1); CODE=$?
echo "$OUT" | sed 's/^/  /'
echo "  exit: $CODE"
if [ "$CODE" -ne 0 ] && echo "$OUT" | grep -qi "codex"; then
  ok "fails loudly and names the missing CLI"
else
  bad "preflight did not fail clearly (exit $CODE)"
fi

step "6. full test suite on this machine"
if npx vitest run --reporter=dot > /tmp/vitest.log 2>&1; then
  ok "$(grep -E 'Tests +[0-9]+ passed' /tmp/vitest.log | tail -1 | sed 's/^ *//')"
else
  bad "test suite failed"; tail -25 /tmp/vitest.log
fi

step "7. tmux monitor path, with stub agents"
# The one path that cannot be tested on a Mac in herdr or iTerm: the Linux fallback where the
# monitor runs in a detached tmux session. Stub CLIs stand in for codex/claude so the plumbing
# (team create, tmux spawn, bridge, monitor) is exercised without any credentials.
mkdir -p /root/stubbin
for name in codex claude; do
  cat > "/root/stubbin/$name" <<STUB
#!/usr/bin/env bash
echo "\$(basename \$0) stub ready"
printf '❯ '
while read -r _line; do printf '❯ '; done
STUB
  chmod +x "/root/stubbin/$name"
done
export PATH="/root/stubbin:$PATH"

LAUNCH=$(COLLAB_SKIP_PREFLIGHT=1 COLLAB_SKIP_POSTCHECK=1 COLLAB_MONITOR=tmux \
  ./scripts/collab-launch.sh /root/ensemble "clean room smoke test" codex,claude 2>&1)
echo "$LAUNCH" | sed 's/^/  /'
TEAM_ID=$(echo "$LAUNCH" | sed -n 's/^TEAM_ID=//p' | tail -1)

if [ -n "$TEAM_ID" ]; then
  ok "team created: $TEAM_ID"
else
  bad "launcher printed no TEAM_ID"
fi

echo "  --- tmux sessions ---"
tmux ls 2>&1 | sed 's/^/    /'
AGENT_SESSIONS=$(tmux ls 2>/dev/null | grep -c "$(echo "$LAUNCH" | grep -o 'collab-[0-9]*-[0-9]*' | head -1)" || echo 0)
MONITOR_SESSION=$(tmux ls 2>/dev/null | grep -c "ensemble-$TEAM_ID" || echo 0)
[ "$AGENT_SESSIONS" -ge 2 ] && ok "$AGENT_SESSIONS agent tmux sessions spawned" || bad "expected 2 agent sessions, saw $AGENT_SESSIONS"
[ "$MONITOR_SESSION" -ge 1 ] && ok "monitor running in its own tmux session (the Linux fallback)" \
  || bad "no detached monitor session ensemble-$TEAM_ID"

echo "  --- monitor pane output ---"
sleep 3
tmux capture-pane -p -t "ensemble-$TEAM_ID" 2>/dev/null | grep -v '^$' | head -8 | sed 's/^/    /' \
  || echo "    (could not capture)"

step "8. disband + cleanup"
curl -sf -X POST "http://localhost:23000/api/ensemble/teams/$TEAM_ID/disband" > /dev/null 2>&1
sleep 4
LEFT=$(tmux ls 2>/dev/null | wc -l)
echo "  tmux sessions left: $LEFT"
[ "$LEFT" -eq 0 ] && ok "everything cleaned up" || echo "  (remaining: $(tmux ls 2>/dev/null | tr '\n' ' '))"

printf '\n\033[1m=== %s ===\033[0m\n' "$([ "$FAILURES" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "$FAILURES CHECK(S) FAILED")"
exit "$FAILURES"
