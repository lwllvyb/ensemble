import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const PRE = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-preflight.sh'), 'utf8')
const LAUNCH = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

// /tmp/collab-agents-override.txt is een vast pad dat elke launch deelt: twee
// starts binnen een seconde kunnen elkaars auto-fallback-aanbeveling lezen.
// Het pad zelf blijft de default (dat is gedocumenteerd gedrag, zie
// docs/collab-scripts.md en de collab-skill), maar alles wat ernaar leest,
// schrijft of het verwijdert moet via $OVERRIDE_FILE lopen, zodat een
// aanroeper die isolatie wil (bv. een toekomstige orchestrator die meerdere
// teams tegelijk start) COLLAB_OVERRIDE_FILE kan zetten en dan een eigen,
// niet-gedeeld pad krijgt.
describe('override', () => {
  it('collab-preflight.sh gebruikt overal de OVERRIDE_FILE-variabele, niet los het vaste pad', () => {
    const literal = PRE.match(/\/tmp\/collab-agents-override\.txt/g) || []
    expect(literal.length).toBe(1)
    expect(PRE).toMatch(/OVERRIDE_FILE="\$\{COLLAB_OVERRIDE_FILE:-\/tmp\/collab-agents-override\.txt\}"/)
  })

  it('collab-launch.sh leest de override via dezelfde variabele en default', () => {
    const literal = LAUNCH.match(/\/tmp\/collab-agents-override\.txt/g) || []
    expect(literal.length).toBe(1)
    expect(LAUNCH).toMatch(/OVERRIDE_FILE="\$\{COLLAB_OVERRIDE_FILE:-\/tmp\/collab-agents-override\.txt\}"/)
  })
})
