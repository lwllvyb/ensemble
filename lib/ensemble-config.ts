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

let invalidConfigWarning: { path: string; mtimeMs: number } | undefined
let invalidFallbackWarning: string | undefined

/** Shared configuration for the service and script entry points. */
export function readEnsembleConfig(): EnsembleConfig {
  let file: Record<string, unknown> = {}
  const configPath = process.env.ENSEMBLE_CONFIG || path.join(os.homedir(), '.config/ensemble/config.json')
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object')
    file = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      let mtimeMs = 0
      try { mtimeMs = fs.statSync(configPath).mtimeMs } catch { /* file disappeared; retain the warning guard */ }
      if (!invalidConfigWarning || invalidConfigWarning.path !== configPath || invalidConfigWarning.mtimeMs !== mtimeMs) {
        console.warn('[Ensemble] Invalid configuration; using defaults and environment overrides')
        invalidConfigWarning = { path: configPath, mtimeMs }
      }
    }
  }
  const value = (key: string, env: string): unknown => process.env[env]?.trim() ? process.env[env] : file[key]
  const config: EnsembleConfig = { fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'gemini'], graceMinutes: 3 }
  const health = value('healthCommand', 'ENSEMBLE_HEALTH_CMD')
  const preamble = value('taskPreamble', 'ENSEMBLE_TASK_PREAMBLE')
  if (typeof health === 'string' && health.trim()) config.healthCommand = health
  if (typeof preamble === 'string' && preamble) config.taskPreamble = preamble
  const rawOrder = process.env.ENSEMBLE_FALLBACK_ORDER
  const order = rawOrder?.trim() ? rawOrder.split(',').map(s => s.trim()) : file.fallbackOrder
  if (Array.isArray(order) && order.length && order.every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s))) config.fallbackOrder = [...new Set(order)]
  else if (rawOrder?.trim() && invalidFallbackWarning !== rawOrder) {
    console.warn('[Ensemble] Invalid ENSEMBLE_FALLBACK_ORDER; using configured fallback order')
    invalidFallbackWarning = rawOrder
  }
  if (rawOrder?.trim() && !(Array.isArray(order) && order.every((s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s)))) {
    const fileOrder = file.fallbackOrder
    if (Array.isArray(fileOrder) && fileOrder.length && fileOrder.every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s))) config.fallbackOrder = [...new Set(fileOrder)]
  }
  for (const [key, env] of [['maxTeamMinutes', 'ENSEMBLE_MAX_TEAM_MINUTES'], ['graceMinutes', 'ENSEMBLE_GRACE_MINUTES']] as const) {
    const raw = value(key, env)
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    if (Number.isFinite(number) && (key === 'maxTeamMinutes' ? number > 0 : number >= 0)) config[key] = number
  }
  return config
}
