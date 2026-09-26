# Ensemble: changelog 26 September 2026

## Reliability and operations

This release tightens the startup and shutdown path for multi-agent teams.

- A configurable health hook can report agent status before launch. An explicitly selected unhealthy agent now makes preflight fail with exit 7. A team time limit asks agents for a final conclusion and stops the team after the configured grace period.
- A task preamble can be configured and is included in every startup prompt.
- Alert hub delivery is opt-in. Set both `ENSEMBLE_ALERT_HUB_URL` and `ALERT_HUB_SECRET` to use the hub. `ALERT_HUB_SECRET` by itself does not select the hub and does not enable direct Telegram. Direct Telegram still requires both `ENSEMBLE_TELEGRAM_BOT_TOKEN` and `ENSEMBLE_TELEGRAM_CHAT_ID`.
- Sentinel completion is stricter: prompt rules 7 and 8 require agents to answer open questions and send the exact `<<COLLAB_DONE>>` sentinel after the latest substantive teammate content. New content requires a substantive response and a fresh sentinel. The watchdog skips further nudges after a sentinel.
- Agent input is guarded so startup text is never sent to a bare shell. Claude Code 2.1.283 trust prompts default to `No, exit`, so the guard selects the trust option before delivery.
- Agents that become unreachable, or whose delivery raises `AgentNotRunningError`, are marked `failed`. Sentinel and idle completion checks ignore failed agents.
- Runtime directories use `/tmp/ensemble/<TEAM_ID>` with mode `0700`. The agent override file defaults inside that runtime root, with an environment override retained.

## Breaking

`COLLAB_AGENTS` no longer disables preflight auto-fallback. Pass agents as the third argument to make a broken agent a hard failure (exit 3, 4, 6 or 7). Every swap is printed as a warning.

## Verification

The changes are covered by the repository test suite, including startup gates, shell input guards,
watchdog behavior, sentinels, runtime permissions, health hooks and alert configuration.
