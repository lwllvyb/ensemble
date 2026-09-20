import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkMemoryEndpoint, exportObservation, resolveMemoryEndpoint } from '../lib/memory-export'
import { __testing } from '../services/ensemble-service'

const observation = { title: 'TEST collab', subtitle: 'a + b', type: 'discovery', narrative: 'TEST narrative', project: 'ensemble-test' }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('claude-mem write contract', () => {
  it('resolves the write route from settings and fallback', () => {
    vi.stubEnv('ENSEMBLE_MEMORY_URL', '')
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValue('{"CLAUDE_MEM_WORKER_PORT":37703}')
    expect(resolveMemoryEndpoint()).toBe('http://localhost:37703/api/memory/save')
    read.mockImplementation(() => { throw new Error('missing') })
    expect(resolveMemoryEndpoint()).toBe('http://localhost:37777/api/memory/save')
  })

  it('sends the strict manual-memory schema and retains collab context', async () => {
    vi.stubEnv('ENSEMBLE_MEMORY_URL', 'http://worker.test/api/memory/save')
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      const valid = Object.keys(body).sort().join() === 'metadata,project,text,title'
        && body.text === 'a + b\n\nTEST narrative'
        && body.metadata.type === 'discovery' && body.metadata.subtitle === 'a + b'
        && body.project === observation.project && body.title === observation.title
      return Response.json(valid ? { success: true, id: 123 } : { error: 'Invalid request body' }, { status: valid ? 200 : 400 })
    })
    expect(await exportObservation(observation)).toMatchObject({ ok: true, observationId: 123 })
  })

  it.each([{}, { success: false }, { success: true }, { success: true, id: '123' }])('does not mistake an unconfirmed 200 for storage: %j', async body => {
    vi.stubGlobal('fetch', async () => Response.json(body))
    expect(await exportObservation(observation)).toMatchObject({ ok: false, failureKind: 'permanent' })
  })

  it.each([400, 401, 403, 404, 405, 422])('marks HTTP %i as a configuration or contract failure', async status => {
    vi.stubGlobal('fetch', async () => new Response('', { status }))
    expect(await exportObservation(observation)).toMatchObject({ ok: false, status, failureKind: 'permanent' })
  })

  it.each([408, 429, 500, 503])('keeps HTTP %i non-fatal and transient', async status => {
    vi.stubGlobal('fetch', async () => new Response('', { status }))
    expect(await exportObservation(observation)).toMatchObject({ ok: false, failureKind: 'transient' })
  })

  it('reports the exact parked file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-contract-'))
    try {
      vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
      const result = await exportObservation(observation, dir)
      expect(result.pendingFile).toBeTruthy()
      expect(JSON.parse(fs.readFileSync(result.pendingFile!, 'utf8')).observation).toEqual(observation)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports when parking failed instead of promising a saved payload', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('disk full') })
    expect(await exportObservation(observation, '/unused')).toMatchObject({ ok: false, parkingError: 'disk full' })
  })

  it('does not treat OPTIONS 404 as reachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    expect((await checkMemoryEndpoint()).ok).toBe(false)
  })

  it('bounds a hanging request and returns a transient failure', async () => {
    vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    expect(await exportObservation(observation, undefined, 10)).toMatchObject({ ok: false, failureKind: 'transient' })
  })

  it('classifies a response-body timeout as transient', async () => {
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('body aborted')))
      }),
    }))
    expect(await exportObservation(observation, undefined, 10)).toMatchObject({ ok: false, failureKind: 'transient' })
  })

  it('classifies an invalid endpoint override as a permanent configuration error', async () => {
    vi.stubEnv('ENSEMBLE_MEMORY_URL', 'not-a-url')
    expect(await exportObservation(observation)).toMatchObject({ ok: false, failureKind: 'permanent' })
  })

  it('makes a permanent export failure red and actionable in the timeline and logs', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const message = __testing.memoryExportFailureMessage({ ok: false, endpoint: 'http://worker/api/memory/save', status: 404, failureKind: 'permanent', pendingFile: '/runtime/pending.json' })
    expect(message).toContain('❌')
    expect(message).toContain('ENSEMBLE_MEMORY_URL')
    expect(message).toContain('/runtime/pending.json')
    expect(log).toHaveBeenCalled()
  })

  it('makes transient failure visible without claiming a parked payload exists', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const message = __testing.memoryExportFailureMessage({ ok: false, endpoint: 'http://worker/api/memory/save', error: 'timeout', failureKind: 'transient', parkingError: 'disk full' })
    expect(message).toContain('⚠️')
    expect(message).toContain('disk full')
    expect(message).not.toContain('Payload bewaard')
    expect(log).toHaveBeenCalled()
  })

  it('contains a rejected export promise during team completion', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(__testing.afhandelenExport(Promise.reject(new Error('unexpected')), () => {})).resolves.toBeUndefined()
  })
})
