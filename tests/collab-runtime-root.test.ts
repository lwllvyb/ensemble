import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const POSTCHECK = path.resolve(process.cwd(), 'scripts/collab-postcheck.sh')
const RESCUE = path.resolve(process.cwd(), 'scripts/collab-rescue.sh')

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-root-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

function run(script: string, args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(script, args, {
      env: { ...process.env, COLLAB_RUNTIME_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { out, code: 0 }
  } catch (err: any) {
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
  }
}

describe('runtime root', () => {
  // Deze test kijkt naar het PAD in de foutmelding, niet naar de tekst ervan.
  // De eerste versie zocht op "Team not found" terwijl de melding "Team <id> not
  // found at <pad>" is, dus die matchte nooit en was groen voor de fix bestond.
  it('postcheck kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    const { out } = run(POSTCHECK, ['team-bestaat-niet'])
    expect(out).toContain(root)
    expect(out).not.toMatch(/\/tmp\/ensemble/)
  })

  it('rescue kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    fs.mkdirSync(path.join(root, 'team-y', 'prompts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'team-y', 'prompts', 'claude-1.txt'), 'hoi')
    const { out } = run(RESCUE, ['team-y'])
    expect(out).not.toMatch(/team-dir bestaat niet/i)
  })
})
