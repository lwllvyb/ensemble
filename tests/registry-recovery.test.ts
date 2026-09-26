import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let root: string
let file: string
let registry: typeof import('../lib/ensemble-registry')
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-recovery-'))
  file = path.join(root, 'ensemble', 'teams.json')
  vi.stubEnv('ENSEMBLE_CREATED_BY', 'test')
  vi.stubEnv('ENSEMBLE_DATA_DIR', root)
  vi.stubEnv('COLLAB_RUNTIME_ROOT', path.join(root, 'runtime'))
  vi.resetModules()
  registry = await import('../lib/ensemble-registry')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(root, { recursive: true, force: true })
})
function create(name: string) {
  return registry.createTeam({ name, description: 'Recovery test', agents: [] })
}
it('recovers the latest successful write from backup after a truncated registry', () => {
  create('first')
  const latest = create('second')
  fs.writeFileSync(file, '[{"id":')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(registry.loadTeams().map(team => team.id)).toContain(latest.id)
  expect(registry.loadTeams()).toHaveLength(2)
  expect(error).toHaveBeenCalled()
})
it('returns an empty list and logs loudly when both registry copies are corrupt', () => {
  create('first')
  fs.writeFileSync(file, '[')
  fs.writeFileSync(`${file}.bak`, '[')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(registry.loadTeams()).toEqual([])
  expect(error).toHaveBeenCalled()
})
it('rejects valid JSON with a non-array registry shape and uses the backup', () => {
  const team = create('first')
  fs.writeFileSync(file, '{}')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(registry.loadTeams()).toEqual([team])
})
it('keeps the published registry intact when writing the replacement fails', () => {
  const team = create('first')
  const write = fs.writeFileSync.bind(fs)
  vi.spyOn(fs, 'writeFileSync').mockImplementation((target, ...args) => {
    if (String(target).startsWith(file) && !String(target).endsWith('.bak')) {
      write(target, '[')
      throw new Error('disk full')
    }
    return write(target, ...args)
  })
  expect(() => registry.saveTeams([])).toThrow('disk full')
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([team])
})
it('skips truncated JSONL records in both stores and warns once across repeated polls', () => {
  const team = create('first')
  const message = { id: 'valid', teamId: team.id, from: 'agent', to: 'team', content: 'hello', type: 'chat' as const, timestamp: '2026-01-01T00:00:00Z' }
  registry.appendMessage(team.id, message)
  const feed = path.join(root, 'ensemble', 'messages', team.id, 'feed.jsonl')
  fs.appendFileSync(feed, '{"id":\n')
  const runtime = path.join(root, 'runtime', team.id)
  fs.mkdirSync(runtime, { recursive: true })
  fs.writeFileSync(path.join(runtime, 'messages.jsonl'), '{"id":\n' + JSON.stringify({ ...message, id: 'second' }) + '\n')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(registry.getMessages(team.id).map(m => m.id)).toEqual(['valid', 'second'])
  expect(registry.getMessages(team.id)).toHaveLength(2)
  expect(warn).toHaveBeenCalledTimes(2)
})
it('marks only the failed agent on the current persisted roster', () => {
  const team = registry.createTeam({ name: 'pair', description: 'Recovery test', agents: [{ program: 'codex' }, { program: 'claude' }] })
  registry.updateTeam(team.id, { status: 'disbanded', agents: team.agents.map(a => ({ ...a, status: 'active' })) })
  registry.markAgentFailed(team.id, team.agents[0].name)
  registry.markAgentFailed(team.id, team.agents[1].name)
  const saved = registry.getTeam(team.id)!
  expect(saved.status).toBe('disbanded')
  expect(saved.agents.map(a => a.status)).toEqual(['failed', 'failed'])
})
