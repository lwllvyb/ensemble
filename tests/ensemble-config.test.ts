import fs from 'fs'
import path from 'path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { readEnsembleConfig } from '../lib/ensemble-config'

const root = fs.mkdtempSync(path.resolve('tmp/config-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(path.join(root, 'config.json'), { force: true }) })
function config(value: unknown) {
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(value))
  vi.stubEnv('ENSEMBLE_CONFIG', file)
}
it('uses optional defaults when the file is absent', () => {
  vi.stubEnv('ENSEMBLE_CONFIG', path.join(root, 'missing'))
  expect(readEnsembleConfig()).toEqual({ fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'agy', 'gemini'], graceMinutes: 3, alertHubUrl: '' })
})
it('reads every setting and gives environment values precedence', () => {
  config({ healthCommand: 'check', fallbackOrder: ['glm'], maxTeamMinutes: 40, graceMinutes: 4, taskPreamble: 'Be concise.' })
  expect(readEnsembleConfig()).toMatchObject({ healthCommand: 'check', maxTeamMinutes: 40, taskPreamble: 'Be concise.' })
  vi.stubEnv('ENSEMBLE_HEALTH_CMD', 'other')
  vi.stubEnv('ENSEMBLE_FALLBACK_ORDER', 'grok,gemini')
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '10')
  vi.stubEnv('ENSEMBLE_GRACE_MINUTES', '0')
  vi.stubEnv('ENSEMBLE_TASK_PREAMBLE', 'Verify results.')
  expect(readEnsembleConfig()).toEqual({ healthCommand: 'other', fallbackOrder: ['grok', 'gemini'], maxTeamMinutes: 10, graceMinutes: 0, taskPreamble: 'Verify results.', alertHubUrl: '' })
})
it('ignores invalid settings without disabling valid ones', () => {
  config({ healthCommand: 42, fallbackOrder: [false], maxTeamMinutes: -1, graceMinutes: 'bad', taskPreamble: 'Keep tests.', alertHubUrl: '' })
  expect(readEnsembleConfig()).toEqual({ fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'agy', 'gemini'], graceMinutes: 3, taskPreamble: 'Keep tests.', alertHubUrl: '' })
})
it('warns and uses defaults for invalid JSON', () => {
  config({})
  fs.writeFileSync(path.join(root, 'config.json'), '{')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(readEnsembleConfig().graceMinutes).toBe(3)
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
it('warns only once while invalid config mtime is unchanged', () => {
  config({})
  fs.writeFileSync(path.join(root, 'config.json'), '{')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  readEnsembleConfig()
  readEnsembleConfig()
  expect(warn).toHaveBeenCalledTimes(1)
  warn.mockRestore()
})
it('warns again after an invalid config mtime changes', () => {
  config({})
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, '{')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  readEnsembleConfig()
  fs.writeFileSync(file, '{  ')
  fs.utimesSync(file, new Date(Date.now() + 2000), new Date(Date.now() + 2000))
  readEnsembleConfig()
  expect(warn).toHaveBeenCalledTimes(2)
  warn.mockRestore()
})
it('keeps file values when environment settings are empty', () => {
  config({ healthCommand: 'file-hook', fallbackOrder: ['glm'], taskPreamble: 'file-preamble', graceMinutes: 9, maxTeamMinutes: 20 })
  vi.stubEnv('ENSEMBLE_HEALTH_CMD', '')
  vi.stubEnv('ENSEMBLE_FALLBACK_ORDER', '')
  vi.stubEnv('ENSEMBLE_TASK_PREAMBLE', '')
  vi.stubEnv('ENSEMBLE_GRACE_MINUTES', '')
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '')
  expect(readEnsembleConfig()).toMatchObject({ healthCommand: 'file-hook', fallbackOrder: ['glm'], taskPreamble: 'file-preamble', graceMinutes: 9, maxTeamMinutes: 20 })
})
it('warns once for an invalid fallback order from the environment', () => {
  config({ fallbackOrder: ['glm'] })
  vi.stubEnv('ENSEMBLE_FALLBACK_ORDER', 'glm, bad value')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(readEnsembleConfig().fallbackOrder).toEqual(['glm'])
  expect(readEnsembleConfig().fallbackOrder).toEqual(['glm'])
  expect(warn).toHaveBeenCalledTimes(1)
  warn.mockRestore()
})
it('keeps TypeScript runtime artifacts under the configured test root', async () => {
  vi.stubEnv('COLLAB_RUNTIME_ROOT', root)
  vi.resetModules()
  const { collabSummaryFile } = await import('../lib/collab-paths')
  expect(collabSummaryFile('sample')).toBe(path.join(root, 'sample', 'summary.txt'))
})

it('reads the alert hub URL from file and gives the environment precedence', () => {
  config({ alertHubUrl: 'https://alerts.example.test/ingest' })
  expect(readEnsembleConfig().alertHubUrl).toBe('https://alerts.example.test/ingest')
  vi.stubEnv('ENSEMBLE_ALERT_HUB_URL', ' https://override.example.test/ingest ')
  expect(readEnsembleConfig().alertHubUrl).toBe('https://override.example.test/ingest')
})
it('disables the alert hub with an explicitly empty environment override', () => {
  config({ alertHubUrl: 'https://alerts.example.test/ingest' })
  vi.stubEnv('ENSEMBLE_ALERT_HUB_URL', '')
  expect(readEnsembleConfig().alertHubUrl).toBe('')
})
it.each([42, null, '   '])('ignores invalid or blank alert hub configuration %j', alertHubUrl => {
  config({ alertHubUrl })
  expect(readEnsembleConfig().alertHubUrl).toBe('')
})

it('reads agentEnv without trimming values or applying an environment override', () => {
  config({ agentEnv: { MY_TOOL_NESTED: '1', _EMPTY: '', WITH_SPACE: ' value ' } })
  vi.stubEnv('ENSEMBLE_AGENT_ENV', '{"OTHER":"ignored"}')
  expect(readEnsembleConfig().agentEnv).toEqual({ MY_TOOL_NESTED: '1', _EMPTY: '', WITH_SPACE: ' value ' })
})
it('ignores invalid agentEnv entries with one names-only warning across repeated reads', () => {
  config({ agentEnv: {
    GOOD_1: 'ok', lowercase: 'secret-one', 'BAD-NAME': 'secret-two', '1BAD': 'secret-three',
    NUMBER: 42, OBJECT: {}, LF: 'secret\nvalue', CR: 'secret\rvalue', 'BAD\nKEY': 'secret-four', 'TRAILING\n': 'secret-five',
  } })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(readEnsembleConfig().agentEnv).toEqual({ GOOD_1: 'ok' })
  readEnsembleConfig()
  expect(warn).toHaveBeenCalledTimes(1)
  const warning = String(warn.mock.calls[0][0])
  expect(warning).toContain('lowercase')
  expect(warning).toContain('LF')
  expect(warning).not.toMatch(/secret|42|\n|\r/)
})
it.each([null, [], 'secret-string', 42])('ignores non-object agentEnv %j with one warning', agentEnv => {
  config({ agentEnv })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(readEnsembleConfig().agentEnv).toBeUndefined()
  readEnsembleConfig()
  expect(warn).toHaveBeenCalledTimes(1)
  expect(String(warn.mock.calls[0][0])).not.toContain('secret-string')
})
