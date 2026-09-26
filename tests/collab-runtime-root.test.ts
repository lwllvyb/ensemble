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
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
  }
}

describe('runtime root', () => {
  it('trimt witruimte rond COLLAB_RUNTIME_ROOT zoals de TypeScript-paden', () => {
    const trimmed = path.join(root, 'team-trim')
    const out = execFileSync('/bin/bash', ['-c', `source '${path.resolve(process.cwd(), 'scripts/collab-paths.sh')}'; collab_runtime_dir team-trim`], {
      env: { ...process.env, COLLAB_RUNTIME_ROOT: `  ${trimmed}  ` }, encoding: 'utf8',
    })
    expect(out.trim()).toBe(path.join(trimmed, 'team-trim'))
  })

  // Deze test kijkt naar het PAD in de foutmelding, niet naar de tekst ervan.
  // De eerste versie zocht op "Team not found" terwijl de melding "Team <id> not
  // found at <pad>" is, dus die matchte nooit en was groen voor de fix bestond.
  it('postcheck kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    const teamId = 'team-bestaat-niet'
    const { out, code } = run(POSTCHECK, [teamId])
    expect(code).toBe(1)
    expect(out).toContain(`not found at ${path.join(root, teamId)}\n`)
    expect(out).not.toContain(`not found at ${path.join('/tmp/ensemble', teamId)}\n`)
  })

  it('rescue kijkt in COLLAB_RUNTIME_ROOT, niet in /tmp/ensemble', () => {
    fs.mkdirSync(path.join(root, 'team-y', 'prompts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'team-y', 'prompts', 'claude-1.txt'), 'hoi')
    const { out } = run(RESCUE, ['team-y'])
    expect(out).toContain('geen sessieregister voor team-y')
  })
})

it('cleanup resolves the same trimmed runtime root as team scripts', () => {
  const out = execFileSync('/bin/bash', [path.resolve('scripts/collab-cleanup.sh')], {
    env: { ...process.env, COLLAB_RUNTIME_ROOT: `  ${root}  ` }, encoding: 'utf8',
  })
  expect(out).toContain('No finished or abandoned collabs found')
  expect(out).not.toContain('No runtime root found')
})
