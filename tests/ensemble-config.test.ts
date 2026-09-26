import fs from 'fs'
import path from 'path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { readEnsembleConfig } from '../lib/ensemble-config'

const root = fs.mkdtempSync(path.resolve('tmp/config-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(path.join(root, 'config.json'), { force: true }) })
function config(value: unknown) {
  const file = path.join(root, 'config.json')
  fs.writeFileSync(file, JSON.stringify(value))
  vi.stubEnv('ENSEMBLE_CONFIG', file)
}
it('uses optional defaults when the file is absent', () => {
  vi.stubEnv('ENSEMBLE_CONFIG', path.join(root, 'missing'))
  expect(readEnsembleConfig()).toEqual({ fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'gemini'], graceMinutes: 3 })
})
it('reads every setting and gives environment values precedence', () => {
  config({ healthCommand: 'check', fallbackOrder: ['glm'], maxTeamMinutes: 40, graceMinutes: 4, taskPreamble: 'Be concise.' })
  expect(readEnsembleConfig()).toMatchObject({ healthCommand: 'check', maxTeamMinutes: 40, taskPreamble: 'Be concise.' })
  vi.stubEnv('ENSEMBLE_HEALTH_CMD', 'other')
  vi.stubEnv('ENSEMBLE_FALLBACK_ORDER', 'grok,gemini')
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '10')
  vi.stubEnv('ENSEMBLE_GRACE_MINUTES', '0')
  vi.stubEnv('ENSEMBLE_TASK_PREAMBLE', 'Verify results.')
  expect(readEnsembleConfig()).toEqual({ healthCommand: 'other', fallbackOrder: ['grok', 'gemini'], maxTeamMinutes: 10, graceMinutes: 0, taskPreamble: 'Verify results.' })
})
it('ignores invalid settings without disabling valid ones', () => {
  config({ healthCommand: 42, fallbackOrder: [false], maxTeamMinutes: -1, graceMinutes: 'bad', taskPreamble: 'Keep tests.' })
  expect(readEnsembleConfig()).toEqual({ fallbackOrder: ['codex', 'claude', 'glm', 'grok', 'gemini'], graceMinutes: 3, taskPreamble: 'Keep tests.' })
})
it('warns and uses defaults for invalid JSON', () => {
  config({})
  fs.writeFileSync(path.join(root, 'config.json'), '{')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(readEnsembleConfig().graceMinutes).toBe(3)
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
it('keeps TypeScript runtime artifacts under the configured test root', async () => {
  vi.stubEnv('COLLAB_RUNTIME_ROOT', root)
  vi.resetModules()
  const { collabSummaryFile } = await import('../lib/collab-paths')
  expect(collabSummaryFile('sample')).toBe(path.join(root, 'sample', 'summary.txt'))
})
