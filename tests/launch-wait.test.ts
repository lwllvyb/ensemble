import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('wachtlus', () => {
  it('checkt voordat hij slaapt', () => {
    // Anker op de melding vlak vóór de lus, niet op de lus-syntax zelf: de
    // loopvariabele heet hier "_" (net als de agent-wachtlus verderop in dit
    // bestand), niet "i".
    const anker = SRC.indexOf('Starting server')
    expect(anker).toBeGreaterThan(-1)
    const lus = SRC.slice(anker, anker + 400)
    const check = lus.indexOf('curl')
    const slaap = lus.indexOf('sleep')
    expect(check).toBeGreaterThan(-1)
    expect(slaap).toBeGreaterThan(-1)
    expect(check).toBeLessThan(slaap)
  })
})
