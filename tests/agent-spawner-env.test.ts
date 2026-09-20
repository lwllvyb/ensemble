import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'lib/agent-spawner.ts'), 'utf8')

describe('env-forwarding', () => {
  it('escapet de waarde', () => {
    expect(SRC).not.toMatch(/export \$\{k\}="\$\{v\}"/)
    expect(SRC).toMatch(/export \$\{k\}=\$\{shellEscape/)
  })
})
