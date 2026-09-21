import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-ev-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

function evidence(dir: string): number {
  const paths = path.resolve(process.cwd(), 'scripts/collab-paths.sh')
  try {
    execFileSync('bash', ['-c', `. "${paths}" && team_has_evidence "${dir}"`], { encoding: 'utf8' })
    return 0
  } catch (err: unknown) {
    return (err as { status?: number }).status ?? 1
  }
}

describe('team_has_evidence', () => {
  it('is onwaar bij een lege messages.jsonl', () => {
    const dir = path.join(root, 'leeg')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '')
    expect(evidence(dir)).toBe(1)
  })

  it('is waar zodra er een bericht staat', () => {
    const dir = path.join(root, 'vol')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'messages.jsonl'), '{"from":"claude-1"}\n')
    expect(evidence(dir)).toBe(0)
  })
})
