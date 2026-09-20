import { beforeEach, describe, expect, it, vi } from 'vitest'

// pasteFromFile praat rechtstreeks met child_process.exec (via promisify) en
// heeft geen eigen naad om een exec-functie in te spuiten. child_process wordt
// hier dus als module gemockt, zodat tmux-commando's onderschept kunnen worden
// zonder dat er een echte tmux-server nodig is. vi.hoisted is nodig omdat
// vi.mock naar de top van het bestand wordt gehesen, vóór deze declaraties.
const { execMock, callLog } = vi.hoisted(() => {
  const callLog: string[] = []
  const execMock = vi.fn((...args: unknown[]) => {
    const cmd = args[0] as string
    const callback = args[args.length - 1] as (err: Error | null, stdout?: string, stderr?: string) => void
    callLog.push(cmd)
    const sendKeysSoFar = callLog.filter(c => c.includes('send-keys')).length
    // Alleen de TWEEDE Enter faalt, precies het scenario uit meting #90: de
    // paste zelf en de eerste Enter lukken.
    if (cmd.includes('send-keys') && sendKeysSoFar === 2) {
      callback(new Error('tmux busy'))
      return
    }
    callback(null, '', '')
  })
  return { execMock, callLog }
})

vi.mock('child_process', () => ({
  exec: execMock,
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))

import { TmuxRuntime } from '../lib/agent-runtime'

describe('pasteFromFile', () => {
  beforeEach(() => {
    callLog.length = 0
    execMock.mockClear()
  })

  it('plakt niet opnieuw als alleen de tweede Enter faalt', async () => {
    const runtime = new TmuxRuntime()
    await runtime.pasteFromFile('sess', '/tmp/x.txt')
    const pasteCalls = callLog.filter(c => c.includes('paste-buffer'))
    expect(pasteCalls.length).toBe(1)
  })
})
