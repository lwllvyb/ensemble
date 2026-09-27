import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterAll, expect, it } from 'vitest'
import { createTeamWorktree } from '../lib/worktree-manager'

const root = fs.mkdtempSync(path.resolve('tmp/shared-worktree-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'absent-config'), GIT_CONFIG_NOSYSTEM: '1' } }).trim()
const worktrees: string[] = []
afterAll(() => {
  for (const file of worktrees) fs.rmSync(path.dirname(file), { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
it('requires a git repository', async () => {
  // A directory inside this repository would inherit its git metadata.
  const invalid = path.join(root, 'missing')
  await expect(createTeamWorktree('missing-team', invalid)).rejects.toThrow('requires a git repository')
})
it('creates a shared branch at HEAD without changing the original branch', async () => {
  git('init')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Initial fixture')
  const head = git('rev-parse', 'HEAD')
  const branch = git('symbolic-ref', '--short', 'HEAD')
  const tree = await createTeamWorktree('abcdefgh-extra', root)
  worktrees.push(tree.path)
  expect(tree.branch).toBe('ensemble/abcdefgh')
  expect(git('rev-parse', tree.branch)).toBe(head)
  expect(git('symbolic-ref', '--short', 'HEAD')).toBe(branch)
  expect(fs.existsSync(tree.path)).toBe(true)
  expect(path.relative(root, tree.path).startsWith('..')).toBe(true)
})
