import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { checkAgentHealth } from '../lib/agent-health'

const root = fs.mkdtempSync(path.resolve('tmp/health-'))
afterEach(() => vi.unstubAllEnvs())
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
function hook(output: unknown, body?: string) {
  const script = path.join(root, 'hook.cjs')
  fs.writeFileSync(script, body ?? `process.stdout.write(${JSON.stringify(JSON.stringify(output))})`)
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
}
const defaults = { fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'gemini'], graceMinutes: 3 }
it('does nothing without a hook', async () => {
  expect(await checkAgentHealth(['codex', 'claude'], false, defaults)).toEqual({ warnings: [] })
})
it('blocks explicit down and limit agents and reports working alternatives', async () => {
  const healthCommand = hook({ codex: { status: 'limit', detail: 'quota exhausted' }, claude: { status: 'ok' }, glm: { status: 'down' } })
  const result = await checkAgentHealth(['codex', 'glm'], true, { ...defaults, healthCommand })
  expect(result.blocked).toEqual(['codex', 'glm'])
  expect(result.healthy).toEqual(['claude'])
  expect(result.warnings.join(' ')).toContain('quota exhausted')
})
it('replaces default failures in preference order without duplicates', async () => {
  const healthCommand = hook({ codex: { status: 'down' }, claude: { status: 'ok' }, glm: { status: 'ok' } })
  expect((await checkAgentHealth(['codex', 'claude'], false, { ...defaults, healthCommand })).agents).toEqual(['glm', 'claude'])
})
it('blocks when no healthy replacement exists', async () => {
  const healthCommand = hook({ codex: { status: 'down' }, claude: { status: 'ok' } })
  expect((await checkAgentHealth(['codex', 'claude'], false, { ...defaults, healthCommand })).blocked).toEqual(['codex'])
})
it('warns for slow and missing results but keeps the requested agents', async () => {
  const healthCommand = hook({ codex: { status: 'slow' } })
  const result = await checkAgentHealth(['codex', 'claude'], true, { ...defaults, healthCommand })
  expect(result.agents).toEqual(['codex', 'claude'])
  expect(result.warnings.join(' ')).toMatch(/slow.*unknown/)
})
it.each(['process.stdout.write("broken")', 'process.exit(2)', 'process.stdout.write("[]")', 'process.stdout.write(JSON.stringify({codex:{status:"invalid"}}))'])('fails open for a broken hook: %s', async body => {
  const result = await checkAgentHealth(['codex'], true, { ...defaults, healthCommand: hook(null, body) })
  expect(result.agents).toBeUndefined()
  expect(result.blocked).toBeUndefined()
  expect(result.warnings.join(' ')).toContain('Health hook failed')
})
it('bounds hung hooks and continues', async () => {
  const result = await checkAgentHealth(['codex'], true, { ...defaults, healthCommand: hook(null, 'setInterval(() => {}, 1000)') }, 50)
  expect(result.warnings.join(' ')).toContain('Health hook failed')
  expect(result.blocked).toBeUndefined()
})
it('passes requested keys and fallback candidates as separate arguments', async () => {
  const healthCommand = hook(null, 'process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(2).map(k => [k,{status:"ok"}]))))')
  const result = await checkAgentHealth(['custom'], true, { ...defaults, healthCommand })
  expect(result.agents).toEqual(['custom'])
  expect(result.healthy).toEqual(['custom', ...defaults.fallbackOrder])
})
it('terminates hook descendants on timeout', async () => {
  const marker = path.join(root, 'orphan-marker')
  const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'still running'), 500)`
  const body = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore'}); setInterval(() => {}, 1000)`
  const result = await checkAgentHealth(['codex'], true, { ...defaults, healthCommand: hook(null, body) }, 200)
  expect(result.warnings.join(' ')).toContain('Health hook failed')
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(fs.existsSync(marker)).toBe(false)
})
it('rejects parseable output when the hook exits unsuccessfully or writes trailing data', async () => {
  const result = await checkAgentHealth(['codex'], true, { ...defaults, healthCommand: hook(null, 'process.stdout.write(JSON.stringify({codex:{status:"ok"}})); setTimeout(() => { process.stdout.write("garbage"); process.exit(2) }, 10)') }, 1000)
  expect(result.agents).toBeUndefined()
  expect(result.warnings.join(' ')).toContain('Health hook failed')
})

async function helperProcess(entry: string, env: Record<string, string>, limitMs: number) {
  const child = spawn(process.execPath, ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), entry, 'codex', '1'], {
    env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, limitMs)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('exit', resolve)
    child.on('error', reject)
  }).finally(() => {
    clearTimeout(timer)
    child.stdout.destroy()
    child.stderr.destroy()
  })
  return { code, timedOut, stdout, stderr }
}
function cleanChild(pidFile: string) {
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 'SIGKILL') } catch { /* child already exited */ }
    }
  }
}
it('exits the helper process within two seconds when sleep inherits stdout after JSON', async () => {
  const script = path.join(root, 'background.sh')
  const pidFile = path.join(root, 'sleep.pid')
  fs.writeFileSync(script, `printf '%s' '{"codex":{"status":"ok"}}'\nsleep 8 &\necho $! > '${pidFile}'\n`)
  try {
    const result = await helperProcess(path.resolve('scripts/agent-health.ts'), { ENSEMBLE_HEALTH_CMD: `/bin/bash '${script}'` }, 2000)
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('codex')
  } finally { cleanChild(pidFile) }
})
it('lets a library caller exit within timeout plus one second despite a setsid child holding its pipes', async () => {
  const pidFile = path.join(root, 'detached.pid')
  const healthCommand = hook(null, `const child = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { detached: true, stdio: ['ignore', process.stdout, process.stderr] }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000)`)
  const entry = path.join(root, 'caller.mts')
  fs.writeFileSync(entry, `import { checkAgentHealth } from ${JSON.stringify(path.resolve('lib/agent-health.ts'))}; console.log(JSON.stringify(await checkAgentHealth(['codex'], true, ${JSON.stringify({ ...defaults, healthCommand })}, 300)));`)
  try {
    const result = await helperProcess(entry, {}, 1300)
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Health hook failed')
    expect(fs.existsSync(pidFile), 'the setsid child must really have started').toBe(true)
  } finally { cleanChild(pidFile) }
})
