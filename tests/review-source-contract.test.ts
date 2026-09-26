import fs from 'fs'
import { expect, it } from 'vitest'

it('documents teammate wording without the obsolete agreement-based closing rule', () => {
  const source = fs.readFileSync('services/ensemble-service.ts', 'utf8')
  expect(source).toContain('// Scale teammate wording to the number of agents in the team.')
  expect(source).not.toContain('the team as soon as one other agent agrees')
})

it('keeps the watchdog regression documentation before imports', () => {
  const source = fs.readFileSync('tests/watchdog-runaway.test.ts', 'utf8')
  expect(source.trimStart().startsWith('/**')).toBe(true)
})
