import { runShellHook } from './shell-hook'
import type { EnsembleConfig } from './ensemble-config'

interface HealthResult {
  agents?: string[]
  blocked?: string[]
  healthy?: string[]
  warnings: string[]
}
const statuses = new Set(['ok', 'down', 'limit', 'slow', 'unknown'])

/** The configured command is trusted shell code; agent keys are positional arguments. */
export async function checkAgentHealth(requested: string[], explicit: boolean, config: EnsembleConfig, timeoutMs = 60_000): Promise<HealthResult> {
  if (!config.healthCommand) return { warnings: [] }
  try {
    const keys = [...new Set([...requested, ...config.fallbackOrder])]
    const stdout = await runShellHook(config.healthCommand, 'health', keys, timeoutMs)
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid health object')
    const health = parsed as Record<string, { status: string; detail?: string }>
    for (const entry of Object.values(health)) {
      if (!entry || typeof entry !== 'object' || !statuses.has(entry.status) || (entry.detail !== undefined && typeof entry.detail !== 'string')) throw new Error('invalid health entry')
    }
    const healthy = Object.keys(health).filter(key => health[key].status === 'ok')
    const warnings: string[] = []
    const failed = requested.filter(key => ['down', 'limit'].includes(health[key]?.status))
    for (const key of requested) {
      const status = health[key]?.status ?? 'unknown'
      if (status !== 'ok') warnings.push(`${key}: ${status}${health[key]?.detail ? ` (${health[key].detail})` : ''}`)
    }
    if (explicit && failed.length) return { blocked: failed, healthy, warnings }
    const agents = [...requested]
    const blocked: string[] = []
    for (const key of failed) {
      const replacement = config.fallbackOrder.find(candidate => health[candidate]?.status === 'ok' && !agents.includes(candidate))
      if (!replacement) blocked.push(key)
      else {
        agents[agents.indexOf(key)] = replacement
        warnings.push(`Auto-fallback: ${key} -> ${replacement}`)
      }
    }
    return blocked.length ? { blocked, healthy, warnings } : { agents, healthy, warnings }
  } catch {
    return { warnings: ['Health hook failed or timed out; continuing with existing preflight checks'] }
  }
}
