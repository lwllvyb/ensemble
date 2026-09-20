import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'scripts/collab-launch.sh'), 'utf8')

describe('herdr-monitor', () => {
  it('leest de pane-id voordat het vinkje verschijnt', () => {
    const blok = SRC.slice(SRC.indexOf('open-herdr-monitor.sh'), SRC.indexOf('Falling back to tmux'))
    expect(blok.indexOf('HERDR_PANE=')).toBeLessThan(blok.indexOf('Monitor opened'))
  })
})
