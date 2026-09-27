import { expect, it } from 'vitest'
import { runShellHook } from '../lib/shell-hook'

it('accepts a successful hook that closes stdin without reading it', async () => {
  await expect(runShellHook('exec 0<&-; exit 0', 'early-exit', [], 5_000, 'input'.repeat(100_000))).resolves.toBe('')
})
