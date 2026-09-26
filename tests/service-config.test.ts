import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'

let root: string
let current: EnsembleTeam | undefined
let messages: EnsembleMessage[]
let service: typeof import('../services/ensemble-service')
const paste = vi.fn(async () => {})
const kill = vi.fn(async () => {})
const start = Date.parse('2026-01-01T12:00:00Z')
beforeEach(async () => {
  root = fs.mkdtempSync(path.resolve('tmp/service-config-'))
  vi.stubEnv('COLLAB_RUNTIME_ROOT', root)
  vi.stubEnv('ENSEMBLE_CONFIG', path.join(root, 'config.json'))
  vi.stubEnv('ENSEMBLE_DATA_DIR', path.join(root, 'data'))
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '10')
  vi.stubEnv('ENSEMBLE_GRACE_MINUTES', '3')
  vi.useFakeTimers()
  vi.setSystemTime(start)
  vi.resetModules()
  current = undefined
  messages = []
  paste.mockClear(); kill.mockClear()
  vi.doMock('../lib/ensemble-registry', () => ({
    loadTeams: () => current ? [current] : [], getTeam: () => current,
    getMessages: () => messages,
    appendMessage: (_id: string, message: EnsembleMessage) => messages.push(message),
    updateTeam: (_id: string, updates: Partial<EnsembleTeam>) => Object.assign(current!, updates),
    createTeam: vi.fn(), saveTeams: vi.fn(),
  }))
  vi.doMock('../lib/agent-spawner', () => ({
    spawnLocalAgent: vi.fn(), spawnRemoteAgent: vi.fn(), killLocalAgent: kill,
    killRemoteAgent: kill, getAgentTokenUsage: async () => 'unknown',
    postRemoteSessionCommand: vi.fn(), isRemoteSessionReady: vi.fn(),
  }))
  vi.doMock('../lib/agent-runtime', () => ({ getRuntime: () => ({ sessionExists: async () => true, pasteFromFile: paste }) }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getSelfHostId: () => 'local', getHostById: vi.fn() }))
  vi.doMock('../lib/agent-watchdog', () => ({ AgentWatchdog: class { stop() {} } }))
  vi.doMock('../lib/memory-export', () => ({
    checkMemoryEndpoint: async () => ({ ok: true, endpoint: 'disabled-in-test' }),
    exportObservation: async () => ({ ok: true }),
  }))
  service = await import('../services/ensemble-service')
  current = {
    id: 'deadline-team', name: 'deadline-team', description: 'Inspect code', status: 'active',
    agents: ['alpha', 'beta'].map((name, i) => ({ agentId: name, name, program: 'codex', role: i ? 'member' : 'lead', status: 'active', hostId: 'local' })),
    createdBy: 'test', createdAt: new Date(start).toISOString(), feedMode: 'live',
  }
  messages.push({ id: 'first', teamId: current.id, from: 'alpha', to: 'team', content: 'Analysis in progress', type: 'chat', timestamp: new Date(start).toISOString() })
})
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules()
  for (const name of ['ensemble-registry', 'agent-spawner', 'agent-runtime', 'hosts-config', 'agent-watchdog', 'memory-export']) vi.doUnmock(`../lib/${name}`)
  fs.rmSync(root, { recursive: true, force: true })
})
it('leaves teams unlimited by default', async () => {
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '')
  vi.setSystemTime(start + 24 * 60 * 60_000)
  await service.checkIdleTeams()
  expect(messages).toHaveLength(1)
  expect(current!.status).toBe('active')
})
it('delivers one deadline warning to all active agents despite recent activity', async () => {
  vi.setSystemTime(start + 9 * 60_000)
  await service.checkIdleTeams()
  expect(messages).toHaveLength(1)
  vi.setSystemTime(start + 10 * 60_000)
  messages[0].timestamp = new Date().toISOString()
  await service.checkIdleTeams()
  await service.checkIdleTeams()
  expect(messages.filter(m => m.content.includes('<<COLLAB_DONE>>'))).toHaveLength(1)
  expect(paste.mock.calls).toHaveLength(2)
  expect(current!.status).toBe('active')
})
it('allows a full grace period after a late warning then writes the time-limit summary', async () => {
  vi.setSystemTime(start + 20 * 60_000)
  await service.checkIdleTeams()
  expect(current!.status).toBe('active')
  vi.setSystemTime(start + 23 * 60_000 - 1)
  await service.checkIdleTeams()
  expect(current!.status).toBe('active')
  vi.setSystemTime(start + 23 * 60_000)
  await service.checkIdleTeams()
  expect(current!.status).toBe('disbanded')
  expect(kill).toHaveBeenCalledTimes(2)
  expect(fs.readFileSync(path.join(root, current!.id, 'summary.txt'), 'utf8')).toContain('Reason: team stopped on time limit')
  expect(fs.existsSync(path.join(root, current!.id, '.finished'))).toBe(true)
})
it('supports zero grace and teams with no agent messages', async () => {
  vi.stubEnv('ENSEMBLE_GRACE_MINUTES', '0')
  messages = []
  vi.setSystemTime(start + 10 * 60_000)
  await service.checkIdleTeams()
  expect(current!.status).toBe('disbanded')
  expect(fs.readFileSync(path.join(root, current!.id, 'summary.txt'), 'utf8')).toContain('Reason: team stopped on time limit')
})
it.each([[[]], [['beta']], [['beta', 'gamma']]])('puts the preamble before the task for teammates %j', teammates => {
  vi.stubEnv('ENSEMBLE_TASK_PREAMBLE', 'Use project conventions.')
  const prompt = service.buildPromptPreview({ teamId: 'sample', teamName: 'sample', description: 'Inspect code', agentName: 'alpha', teammateNames: teammates, agentIndex: 0 })
  expect(prompt.indexOf('Use project conventions.')).toBeGreaterThan(-1)
  expect(prompt.indexOf('Use project conventions.')).toBeLessThan(prompt.indexOf('Task: Inspect code'))
})
it('requires new information and no outstanding questions, without an approval loop', () => {
  const prompt = service.buildPromptPreview({ teamId: 'sample', teamName: 'sample', description: 'Inspect code', agentName: 'alpha', teammateNames: ['beta'], agentIndex: 0 })
  expect(prompt).toContain('do not leave open questions addressed to you unresolved')
  expect(prompt).toContain('Do not send status messages without new information')
  expect(prompt).toContain('do not wait for an approval')
  expect(prompt).toContain('EXACTLY the sentinel <<COLLAB_DONE>>')
  expect(prompt).not.toContain('confirmed agreement')
})
