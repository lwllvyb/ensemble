import { readEnsembleConfig, type EnsembleConfig } from './ensemble-config'
import { runShellHook } from './shell-hook'

export type Roster = Record<string, { status: 'ok' | 'down' | 'limit' | 'slow' | 'unknown'; detail?: string }>
export interface BrainPlan { agents: string[]; template?: string; reason?: string }
export interface BrainEvent {
  event: 'team_started' | 'agent_ready' | 'agent_stalled' | 'agent_replaced' | 'agent_failed' | 'agent_done' | 'team_finished'
  teamId: string
  team: string
  ts: string
  agent?: string
  replacement?: string
  agents?: string[]
  cwd?: string
  branch?: string
  status?: 'ok' | 'failed' | 'stopped'
  durationS?: number
  detail?: string
}

export async function runRoster(config = readEnsembleConfig(), timeoutMs = 5000): Promise<Roster | undefined> {
  if (!config.rosterCommand) return undefined
  try {
    const result = JSON.parse(await runShellHook(config.rosterCommand, 'roster', [], timeoutMs))
    if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
    for (const entry of Object.values(result) as Roster[string][]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !['ok', 'down', 'limit', 'slow', 'unknown'].includes(entry.status) || (entry.detail !== undefined && typeof entry.detail !== 'string')) return undefined
    }
    return result
  } catch { return undefined }
}

export async function runPlan(task: string, config = readEnsembleConfig(), timeoutMs = 20_000): Promise<BrainPlan | undefined> {
  if (!config.planCommand) return undefined
  try {
    const result = JSON.parse(await runShellHook(config.planCommand, 'plan', [task], timeoutMs))
    if (!result || !Array.isArray(result.agents) || !result.agents.length || !result.agents.every((key: unknown) => typeof key === 'string' && /^[a-zA-Z0-9_-]+$/.test(key))) return undefined
    if (result.template !== undefined && typeof result.template !== 'string') return undefined
    if (result.reason !== undefined && typeof result.reason !== 'string') return undefined
    return { agents: result.agents, template: result.template, reason: result.reason }
  } catch { return undefined }
}

const warnedTeams = new Set<string>()
/** Callers deliberately do not await delivery. Failures are contained here. */
export async function emitEvent(event: BrainEvent, config: EnsembleConfig = readEnsembleConfig(), timeoutMs = 5000): Promise<void> {
  if (!config.eventsCommand) return
  try {
    await runShellHook(config.eventsCommand, 'events', [], timeoutMs, JSON.stringify(event) + '\n')
  } catch {
    if (!warnedTeams.has(event.teamId)) {
      warnedTeams.add(event.teamId)
      console.warn(`[Ensemble] Event hook failed for team ${event.teamId}`)
    }
  }
}
