import fs from 'fs'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'
import { clearAgentsConfigCache, loadAgentsConfig } from '../lib/agent-config'

let root: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  clearAgentsConfigCache()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

it('loads agy with its startup and input configuration while retaining gemini', () => {
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', path.resolve('agents.json'))
  const config = loadAgentsConfig()
  expect(config.agy).toEqual({
    name: 'agy', command: 'agy', flags: ['--dangerously-skip-permissions'],
    readyMarker: '? for shortcuts', inputMethod: 'sendKeys', color: 'red', icon: '▲',
    unsetEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  })
  expect(config.gemini.command).toBe('gemini')
})

it.each([
  ['lowercase'], ['1INVALID'], ['BAD-NAME'], ['X;touch bad'], ['KEY\n'], [42],
  'GEMINI_API_KEY', null, {},
].map(unsetEnv => [unsetEnv]))('rejects invalid unsetEnv: %j', unsetEnv => {
  root = fs.mkdtempSync(path.resolve('tmp/unset-env-'))
  const file = path.join(root, 'agents.json')
  fs.writeFileSync(file, JSON.stringify({ probe: { name: 'probe', unsetEnv } }))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(() => loadAgentsConfig()).toThrow(/unsetEnv/)
  // A rejected configuration must not become the cached configuration.
  expect(() => loadAgentsConfig()).toThrow(/unsetEnv/)
})

it('accepts uppercase names, underscores and digits, and empty or absent lists', () => {
  root = fs.mkdtempSync(path.resolve('tmp/unset-env-'))
  const file = path.join(root, 'agents.json')
  const config = { probe: { unsetEnv: ['_KEY_2', 'A'] }, empty: { unsetEnv: [] }, absent: {} }
  fs.writeFileSync(file, JSON.stringify(config))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', file)
  expect(loadAgentsConfig()).toEqual(config)
})
