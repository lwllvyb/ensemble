import { spawn } from 'child_process'
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
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('/bin/bash', ['-c', `${config.healthCommand} "$@"`, 'ensemble-health', ...keys], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      let bytes = 0
      let settled = false
      let exitedSuccessfully = false
      let stdoutClosed = false
      let closeTimer: ReturnType<typeof setTimeout> | undefined
      const resolveOutput = () => {
        if (settled || !exitedSuccessfully) return
        settled = true
        if (closeTimer) clearTimeout(closeTimer)
        clearTimeout(timer)
        child.stdout?.destroy()
        child.stderr?.destroy()
        resolve(output)
      }
      const fail = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (closeTimer) clearTimeout(closeTimer)
        child.stdout?.destroy()
        child.stderr?.destroy()
        // A hook can launch subprocesses; kill its whole process group.
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
        }
        reject(new Error('health command failed'))
      }
      const timer = setTimeout(fail, timeoutMs)
      child.stdout.setEncoding('utf8')
      child.stdout.once('close', () => {
        stdoutClosed = true
        resolveOutput()
      })
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 1024 * 1024) fail()
        else output += chunk
      })
      child.stderr?.resume()
      child.on('error', fail)
      child.on('exit', code => {
        if (settled) return
        if (code !== 0) { fail(); return }
        exitedSuccessfully = true
        if (stdoutClosed) resolveOutput()
        else closeTimer = setTimeout(resolveOutput, 500)
      })
    })
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
