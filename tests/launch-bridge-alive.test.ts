import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('bridge-start', () => {
  it('controleert met kill -0 of het proces nog leeft voor het vinkje', () => {
    const blok = SRC.slice(SRC.indexOf('ensemble-bridge.sh'), SRC.indexOf('ensemble-bridge.sh') + 700)
    expect(blok).toMatch(/kill -0/)
  })
})
