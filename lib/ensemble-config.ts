import fs from 'fs'
import os from 'os'
import path from 'path'

export interface EnsembleConfig {
  healthCommand?: string
  fallbackOrder: string[]
  maxTeamMinutes?: number
  graceMinutes: number
  taskPreamble?: string
}

/** Shared configuration for the service and script entry points. */
export function readEnsembleConfig(): EnsembleConfig {
  let file: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(process.env.ENSEMBLE_CONFIG || path.join(os.homedir(), '.config/ensemble/config.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object')
    file = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[Ensemble] Invalid configuration; using defaults and environment overrides')
  }
  const value = (key: string, env: string): unknown => process.env[env] ?? file[key]
  const config: EnsembleConfig = { fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'gemini'], graceMinutes: 3 }
  const health = value('healthCommand', 'ENSEMBLE_HEALTH_CMD')
  const preamble = value('taskPreamble', 'ENSEMBLE_TASK_PREAMBLE')
  if (typeof health === 'string' && health.trim()) config.healthCommand = health
  if (typeof preamble === 'string' && preamble) config.taskPreamble = preamble
  const order = process.env.ENSEMBLE_FALLBACK_ORDER?.split(',').map(s => s.trim()) ?? file.fallbackOrder
  if (Array.isArray(order) && order.length && order.every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s))) config.fallbackOrder = [...new Set(order)]
  for (const [key, env] of [['maxTeamMinutes', 'ENSEMBLE_MAX_TEAM_MINUTES'], ['graceMinutes', 'ENSEMBLE_GRACE_MINUTES']] as const) {
    const raw = value(key, env)
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    if (Number.isFinite(number) && (key === 'maxTeamMinutes' ? number > 0 : number >= 0)) config[key] = number
  }
  return config
}
