import fs from 'fs'
import path from 'path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { BrainEvent } from '../lib/brain-hooks'
import type { EnsembleTeam } from '../types/ensemble'

let root: string
let service: typeof import('../services/ensemble-service')
let registry: typeof import('../lib/ensemble-registry')
const plan = vi.fn()
const events = vi.fn(async (_event: BrainEvent) => {})
const spawn = vi.fn(async ({ name }: { name: string }) => ({ id: name }))
const merge = vi.fn()
const destroy = vi.fn()
const createTree = vi.fn()
beforeEach(async () => {
  vi.resetModules()
  root = fs.mkdtempSync(path.resolve('tmp/brain-service-'))
  vi.stubEnv('ENSEMBLE_DATA_DIR', path.join(root, 'data'))
  vi.stubEnv('ENSEMBLE_CONFIG', path.join(root, 'missing'))
  vi.stubEnv('COLLAB_RUNTIME_ROOT', path.join(root, 'runtime'))
  vi.stubEnv('ENSEMBLE_AGENTS_CONFIG', path.resolve('agents.json'))
  vi.useFakeTimers()
  plan.mockReset(); events.mockClear(); spawn.mockClear(); merge.mockClear(); destroy.mockClear()
  createTree.mockReset().mockResolvedValue({ path: path.join(root, 'shared'), branch: 'ensemble/testteam', agentName: 'team' })
  vi.doMock('../lib/brain-hooks', () => ({ runPlan: plan, emitEvent: events, runRoster: vi.fn() }))
  vi.doMock('../lib/agent-spawner', () => ({
    spawnLocalAgent: spawn, killLocalAgent: vi.fn(async () => {}), spawnRemoteAgent: spawn,
    killRemoteAgent: vi.fn(), postRemoteSessionCommand: vi.fn(), isRemoteSessionReady: vi.fn(async () => true), getAgentTokenUsage: vi.fn(async () => 'unknown'),
  }))
  vi.doMock('../lib/agent-runtime', () => ({ getRuntime: () => ({
    capturePane: async () => '› ❯ Type your message', getForegroundCommand: async () => 'node',
    pasteFromFile: vi.fn(async () => {}), sendKeys: vi.fn(async () => {}), sessionExists: async () => true,
  }) }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getSelfHostId: () => 'local', getHostById: () => ({ url: 'http://unused.invalid' }) }))
  vi.doMock('../lib/agent-watchdog', () => ({ AgentWatchdog: class { stop() {} } }))
  vi.doMock('../lib/memory-export', () => ({ checkMemoryEndpoint: async () => ({ ok: true }), exportObservation: async () => ({ ok: true }) }))
  vi.doMock('../lib/worktree-manager', () => ({ createTeamWorktree: createTree, createWorktree: vi.fn(), mergeWorktree: merge, destroyWorktree: destroy }))
  service = await import('../services/ensemble-service')
  registry = await import('../lib/ensemble-registry')
})
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
  for (const module of ['brain-hooks', 'agent-spawner', 'agent-runtime', 'hosts-config', 'agent-watchdog', 'memory-export', 'worktree-manager']) vi.doUnmock(`../lib/${module}`)
  fs.rmSync(root, { recursive: true, force: true })
})
async function finish<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(12_000)
  return promise
}
it.each([undefined, []])('uses a plan with absent or empty agents: %j', async agents => {
  plan.mockResolvedValue({ agents: ['mimo', 'codex'], template: 'implement', reason: 'available capacity' })
  const result = await finish(service.createEnsembleTeam({ name: 'planned', description: 'Implement a feature', agents }))
  expect(result.status).toBe(201)
  expect(result.data!.team.agents.map(a => [a.program, a.role])).toEqual([['mimo', 'lead'], ['codex', 'worker']])
  expect(registry.getMessages(result.data!.team.id).some(m => m.content.includes('available capacity') && m.content.includes('implement'))).toBe(true)
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ event: 'team_started', agents: ['mimo', 'codex'] }))
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_ready', agent: 'mimo-1' }))
})
it('preserves an explicit template and bypasses planning for explicit agents', async () => {
  plan.mockResolvedValue({ agents: ['mimo'], template: 'implement', reason: 'capacity' })
  const planned = await finish(service.createEnsembleTeam({ name: 'template', description: 'Review', templateName: 'review' }))
  expect(registry.getMessages(planned.data!.team.id).some(m => m.content.includes('template: review'))).toBe(true)
  plan.mockClear()
  await finish(service.createEnsembleTeam({ name: 'explicit', description: 'Review', agents: [{ program: 'mimo' }] }))
  expect(plan).not.toHaveBeenCalled()
})
it.each([undefined, { agents: ['unregistered'] }])('falls back when the plan is unavailable or names unknown agents: %j', async result => {
  plan.mockResolvedValue(result)
  const response = await finish(service.createEnsembleTeam({ name: 'fallback', description: 'Review' }))
  expect(response.data!.team.agents.map(a => a.program)).toEqual(['codex', 'claude code'])
})
it('shares one worktree and retains it on disband, including summary and event paths', async () => {
  const response = await finish(service.createEnsembleTeam({ name: 'shared', description: 'Review', agents: [{ program: 'mimo' }, { program: 'codex' }], worktree: 'team', workingDirectory: root }))
  const team = response.data!.team
  expect(createTree).toHaveBeenCalledOnce()
  expect(spawn.mock.calls.every(([options]) => (options as { workingDirectory?: string }).workingDirectory === path.join(root, 'shared'))).toBe(true)
  await service.disbandTeam(team.id)
  expect(merge).not.toHaveBeenCalled()
  expect(destroy).not.toHaveBeenCalled()
  const { collabSummaryFile } = await import('../lib/collab-paths')
  expect(fs.readFileSync(collabSummaryFile(team.id), 'utf8')).toContain('Branch: ensemble/testteam')
  expect(fs.readFileSync(collabSummaryFile(team.id), 'utf8')).toContain(path.join(root, 'shared'))
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ event: 'team_finished', branch: 'ensemble/testteam', cwd: path.join(root, 'shared'), status: 'stopped' }))
})
it('rejects a worktree creation failure before spawning', async () => {
  createTree.mockRejectedValue(new Error('Team worktree requires a git repository in workingDirectory'))
  const result = await service.createEnsembleTeam({ name: 'invalid', description: 'Task', agents: [{ program: 'mimo' }], worktree: 'team' })
  expect(result.status).toBe(400)
  expect(result.error).toContain('requires a git repository')
  expect(spawn).not.toHaveBeenCalled()
})
it('observes the completion sentinel once per agent message', async () => {
  const response = await finish(service.createEnsembleTeam({ name: 'done', description: 'Task', agents: [{ program: 'mimo' }, { program: 'codex' }] }))
  const team: EnsembleTeam = response.data!.team
  registry.appendMessage(team.id, { id: 'done-message', teamId: team.id, from: 'mimo-1', to: 'team', content: '<<COLLAB_DONE>>', type: 'chat', timestamp: new Date().toISOString() })
  await service.checkIdleTeams()
  await service.checkIdleTeams()
  expect(events.mock.calls.filter(([event]) => (event as { event: string }).event === 'agent_done')).toHaveLength(1)
})
