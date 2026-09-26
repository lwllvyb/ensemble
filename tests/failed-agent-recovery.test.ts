import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'

let root: string
const mocked = ['agent-runtime', 'agent-spawner', 'hosts-config', 'memory-export']
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const name of mocked) vi.doUnmock(`../lib/${name}`)
  vi.resetModules()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})
it('persists a crashed agent and disbands when the surviving agent sends its sentinel', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-agent-'))
  vi.stubEnv('ENSEMBLE_DATA_DIR', root)
  vi.stubEnv('COLLAB_RUNTIME_ROOT', path.join(root, 'runtime'))
  vi.stubEnv('ENSEMBLE_CREATED_BY', 'test')
  vi.stubEnv('ENSEMBLE_MAX_TEAM_MINUTES', '')
  vi.stubEnv('ENSEMBLE_WATCHDOG_NUDGE_MS', '1')
  vi.useFakeTimers()
  vi.resetModules()
  const now = Date.now()
  vi.doMock('../lib/agent-runtime', () => ({ getRuntime: () => ({
    pasteFromFile: async (session: string) => {
      if (session.endsWith('codex-1')) throw Object.assign(new Error('Agent stopped'), { name: 'AgentNotRunningError' })
    },
  }) }))
  vi.doMock('../lib/agent-spawner', () => ({
    spawnLocalAgent: vi.fn(), spawnRemoteAgent: vi.fn(), killLocalAgent: async () => {}, killRemoteAgent: async () => {},
    postRemoteSessionCommand: vi.fn(), isRemoteSessionReady: vi.fn(), getAgentTokenUsage: async () => 'unknown',
  }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getHostById: () => undefined, getSelfHostId: () => 'local' }))
  vi.doMock('../lib/memory-export', () => ({ checkMemoryEndpoint: async () => ({ ok: true, endpoint: 'disabled-in-test' }), exportObservation: async () => ({ ok: true }) }))
  const service = await import('../services/ensemble-service')
  const registry = await import('../lib/ensemble-registry')
  const created = registry.createTeam({ name: 'recovery', description: 'Failure test', agents: [{ program: 'codex' }, { program: 'claude' }] })
  registry.updateTeam(created.id, { status: 'active', createdAt: new Date(now).toISOString(), agents: created.agents.map(a => ({ ...a, status: 'active' })) })
  await vi.advanceTimersByTimeAsync(90_000)
  expect(registry.getTeam(created.id)!.agents.map(a => a.status)).toEqual(['failed', 'active'])
  registry.appendMessage(created.id, { id: 'done', teamId: created.id, from: 'claude-2', to: 'team', content: '<<COLLAB_DONE>>', type: 'chat', timestamp: new Date().toISOString() })
  await service.checkIdleTeams()
  expect(registry.getTeam(created.id)!.status).toBe('disbanded')
})
