import fs from 'fs'
import path from 'path'
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
