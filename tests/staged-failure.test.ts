import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, expect, it, vi } from 'vitest'

let root: string
const modules = ['agent-runtime', 'agent-config', 'hosts-config']
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const name of modules) vi.doUnmock(`../lib/${name}`)
  vi.resetModules()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})
it('persists an agent failure when staged startup delivery reaches a bare shell', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-failure-'))
  vi.stubEnv('ENSEMBLE_DATA_DIR', root)
  vi.stubEnv('ENSEMBLE_CREATED_BY', 'test')
  vi.resetModules()
  const failure = Object.assign(new Error('Agent stopped'), { name: 'AgentNotRunningError' })
  vi.doMock('../lib/agent-runtime', () => ({ getRuntime: () => ({
    sendKeys: async (session: string) => { if (session.endsWith('codex-1')) throw failure },
  }) }))
  vi.doMock('../lib/agent-config', () => ({ resolveAgentProgram: () => ({ inputMethod: 'sendKeys' }) }))
  vi.doMock('../lib/hosts-config', () => ({ isSelf: () => true, getHostById: () => undefined }))
  const registry = await import('../lib/ensemble-registry')
  const created = registry.createTeam({ name: 'staged', description: 'Failure test', agents: [{ program: 'codex' }, { program: 'claude' }] })
  const team = registry.updateTeam(created.id, { status: 'active', agents: created.agents.map(a => ({ ...a, status: 'active' })) })!
  const { StagedWorkflowManager } = await import('../lib/staged-workflow')
  await expect(new StagedWorkflowManager({ team }).run()).rejects.toThrow('Agent stopped')
  expect(registry.getTeam(team.id)!.agents.map(a => a.status)).toEqual(['failed', 'active'])
})
