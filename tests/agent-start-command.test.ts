import { execFileSync } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Het startcommando is de enige tekst die bewust in een shell getypt wordt.
// Het mag geen taaktekst bevatten, en ook doorgestuurde ENSEMBLE_*-waarden met
// lastige tekens moeten er als geldige shellsyntax in staan.

const sent: string[] = []
vi.mock('../lib/agent-runtime', () => ({
  getRuntime: () => ({
    createSession: vi.fn(async () => {}),
    sendKeys: vi.fn(async (_s: string, keys: string) => { sent.push(keys) }),
  }),
}))
vi.mock('../lib/hosts-config', () => ({ getSelfHostId: () => 'local' }))

import { spawnLocalAgent } from '../lib/agent-spawner'

const TRICKY = "Anna's test, zo'n klus: \"quote\" `tick` $(id) <<COLLAB_DONE>> ~/.claude\nregel twee"

const hasShell = (sh: string) => { try { execFileSync(sh, ['-c', 'true']); return true } catch { return false } }

describe('startcommando', () => {
  afterEach(() => { delete process.env.ENSEMBLE_TEST_TRICKY; sent.length = 0 })

  it.each(['claude', 'codex'])('%s: bevat geen taaktekst en is geldige shellsyntax', async program => {
    process.env.ENSEMBLE_TEST_TRICKY = TRICKY
    await spawnLocalAgent({ name: `t-${program}-1`, program, workingDirectory: "/tmp/map met spatie en 'quote'" })
    const cmd = sent[0]
    expect(cmd).toBeTruthy()
    expect(cmd).not.toMatch(/Task:|ROLE:/)
    for (const sh of ['bash', 'zsh'].filter(hasShell)) {
      // -n: alleen parsen. Een open quote of heredoc geeft hier een fout.
      expect(() => execFileSync(sh, ['-n', '-c', cmd], { stdio: 'pipe' }), `${sh} -n`).not.toThrow()
    }
    // En de waarde komt er bitgelijk weer uit.
    const echoed = execFileSync('bash', ['-c', `${cmd.replace(/^ nocorrect /, ' ').split('; ').filter(p => p.startsWith('export ENSEMBLE_TEST_TRICKY=')).join('; ')}; printf %s "$ENSEMBLE_TEST_TRICKY"`], { encoding: 'utf8' })
    expect(echoed).toBe(TRICKY)
  })
})
