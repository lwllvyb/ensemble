/**
 * Export a finished collab to claude-mem, so the outcome survives the run.
 *
 * This used to be a one-liner: `fetch('http://localhost:37777/...').catch(() => {})`.
 * Two things were wrong with it, and together they made the feature invisible
 * rather than broken.
 *
 * The port was hardcoded at 37777 while the worker on this machine listens on
 * 37703. The port is derived per machine and is not always 37700 + uid % 100, so
 * guessing it is the wrong approach: it is written in the claude-mem settings.
 *
 * And the empty catch meant a failing export looked exactly like a working one.
 * Measured on 2026-08-14: 3 stored observations, all from 08-08, and 29 teams
 * afterwards that wrote nothing. Nobody could have noticed, because nothing was
 * ever reported. An export that fails must say so.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface MemoryObservation {
  title: string
  subtitle: string
  type: string
  narrative: string
  project: string
}

export interface MemoryExportResult {
  ok: boolean
  endpoint: string
  status?: number
  error?: string
}

const FALLBACK_PORT = 37777

let pendingExportCounter = 0

/**
 * Where a failed export is parked so it is not silently lost.
 *
 * Een vaste naam betekende dat de tweede mislukking de eerste overschreef, en
 * niets las het bestand ooit terug. Een unieke naam per poging maakt de map
 * tenminste een eerlijke lijst van wat er niet is aangekomen. Tijdstip + pid
 * alleen is niet genoeg: twee pogingen binnen dezelfde milliseconde in
 * hetzelfde proces zouden dan nog steeds botsen, dus daar komt een
 * proces-lokale teller bij.
 */
export function pendingExportFile(runtimeDir: string): string {
  pendingExportCounter += 1
  return path.join(runtimeDir, `pending-observation-${Date.now()}-${process.pid}-${pendingExportCounter}.json`)
}

/**
 * Resolve the claude-mem endpoint, in order of trustworthiness:
 * explicit env var, the port claude-mem itself recorded, then the old default.
 */
export function resolveMemoryEndpoint(): string {
  const fromEnv = process.env.ENSEMBLE_MEMORY_URL
  if (fromEnv) return fromEnv

  const settingsPath = path.join(os.homedir(), '.claude-mem', 'settings.json')
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const port = Number(settings['CLAUDE_MEM_WORKER_PORT'])
    if (Number.isInteger(port) && port > 0) return `http://localhost:${port}/api/observations`
  } catch {
    // No settings file, or unreadable: fall through to the default below.
  }
  return `http://localhost:${FALLBACK_PORT}/api/observations`
}

/** True if something answers at the endpoint. Used to warn early, not to block. */
export async function checkMemoryEndpoint(timeoutMs = 2000): Promise<MemoryExportResult> {
  const endpoint = resolveMemoryEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, { method: 'OPTIONS', signal: controller.signal })
    return { ok: res.status < 500, endpoint, status: res.status }
  } catch (err) {
    return { ok: false, endpoint, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Post one observation. Never throws: a failed export must not take a disband
 * down with it. It does report, and it parks the payload for a later retry.
 */
export async function exportObservation(
  observation: MemoryObservation,
  runtimeDir?: string,
  timeoutMs = 5000,
): Promise<MemoryExportResult> {
  const endpoint = resolveMemoryEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(observation),
      signal: controller.signal,
    })
    if (res.ok) return { ok: true, endpoint, status: res.status }

    const result: MemoryExportResult = { ok: false, endpoint, status: res.status }
    park(observation, runtimeDir, result)
    return result
  } catch (err) {
    const result: MemoryExportResult = {
      ok: false,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    }
    park(observation, runtimeDir, result)
    return result
  } finally {
    clearTimeout(timer)
  }
}

function park(observation: MemoryObservation, runtimeDir: string | undefined, result: MemoryExportResult): void {
  if (!runtimeDir) return
  try {
    fs.mkdirSync(runtimeDir, { recursive: true })
    fs.writeFileSync(
      pendingExportFile(runtimeDir),
      JSON.stringify({ observation, attemptedAt: new Date().toISOString(), result }, null, 2),
    )
  } catch {
    // Parking is a courtesy; the caller already logs the real failure.
  }
}
