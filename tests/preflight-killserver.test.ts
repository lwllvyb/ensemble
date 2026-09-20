import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')

describe('preflight kill-server', () => {
  it('weigert kill-server zolang er collab-sessies draaien', () => {
    const blok = SRC.slice(SRC.indexOf('TMUX DNS resolver stale'), SRC.indexOf('TMUX DNS probe inconclusive'))
    expect(blok).toMatch(/collab-/)
    expect(blok).toMatch(/kill-server/)
    const killIndex = blok.indexOf('tmux kill-server')
    const guardIndex = blok.search(/COLLAB_SESSIONS|collab-\*/)
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(killIndex)
  })
})
