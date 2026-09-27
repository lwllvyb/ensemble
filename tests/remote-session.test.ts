import { afterEach, expect, it, vi } from 'vitest'
import { isRemoteSessionReady } from '../lib/agent-spawner'

afterEach(() => vi.unstubAllGlobals())

it('distinguishes an absent remote session from a failed status request', async () => {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce({ status: 503, ok: false })
    .mockResolvedValueOnce({ status: 404, ok: false })
    .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ exists: false }) })
  vi.stubGlobal('fetch', fetchMock)

  expect(await isRemoteSessionReady('http://remote.invalid', 'agent')).toBeUndefined()
  expect(await isRemoteSessionReady('http://remote.invalid', 'agent')).toBeUndefined()
  expect(await isRemoteSessionReady('http://remote.invalid', 'agent')).toBe(false)
  expect(await isRemoteSessionReady('http://remote.invalid', 'agent')).toBe(false)
})
