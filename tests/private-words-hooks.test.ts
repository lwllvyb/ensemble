import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, it } from 'vitest'

const hooks = path.resolve('.githooks')
const tempRoot = path.resolve('tmp')
let repo: string

function run(command: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function list(contents: string) {
  const file = path.join(repo, 'private-words.txt')
  fs.writeFileSync(file, contents)
  return file
}

beforeEach(() => {
  fs.mkdirSync(tempRoot, { recursive: true })
  repo = fs.mkdtempSync(path.join(tempRoot, 'private-hooks-'))
  expect(run('git', ['init', '-q']).status).toBe(0)
})

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

it('blocks a private word in the staged version and reports its file and line', () => {
  const words = list('Secret Client\n')
  const file = path.join(repo, 'example.txt')
  fs.writeFileSync(file, 'public\nSECRET CLIENT details\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  fs.writeFileSync(file, 'public\nclean working copy\n')

  const result = run('bash', [path.join(hooks, 'pre-commit')], { ENSEMBLE_PRIVE_WOORDEN: words })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('example.txt:2: privé-woord nr 1 uit je lijst')
  expect(result.stderr.toLowerCase()).not.toContain('secret client')
})

it('allows an unchanged private word but blocks one on a newly added line during commit', () => {
  const words = list('Secret Client\n')
  const file = path.join(repo, 'example.txt')
  fs.writeFileSync(file, 'Secret Client is already here\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  expect(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial']).status).toBe(0)
  expect(run('git', ['config', 'core.hooksPath', hooks]).status).toBe(0)

  fs.appendFileSync(file, 'A clean new line\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  const env = { ENSEMBLE_PRIVE_WOORDEN: words }
  expect(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'clean addition'], env).status).toBe(0)

  fs.appendFileSync(file, '++ Secret Client reference\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  const blocked = run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'private addition'], env)
  expect(blocked.status).toBe(1)
  expect(blocked.stderr).toContain('example.txt:3: privé-woord nr 1 uit je lijst')
  expect(blocked.stderr.toLowerCase()).not.toContain('secret client')
})

it('blocks a private word in a commit message without printing the word', () => {
  const words = list('Secret Client\n')
  const message = path.join(repo, 'message.txt')
  fs.writeFileSync(message, 'A normal subject\n\nMentions secret CLIENT\n')

  const result = run('bash', [path.join(hooks, 'commit-msg'), message], { ENSEMBLE_PRIVE_WOORDEN: words })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('commit message:3: privé-woord nr 1 uit je lijst')
  expect(result.stderr.toLowerCase()).not.toContain('secret client')
})

it('allows both hooks when the optional list file does not exist', () => {
  const missing = path.join(repo, 'missing.txt')
  fs.writeFileSync(path.join(repo, 'example.txt'), 'Secret Client\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  const message = path.join(repo, 'message.txt')
  fs.writeFileSync(message, 'Secret Client\n')

  const env = { ENSEMBLE_PRIVE_WOORDEN: missing }
  const staged = run('bash', [path.join(hooks, 'pre-commit')], env)
  const commit = run('bash', [path.join(hooks, 'commit-msg'), message], env)
  expect(staged.status).toBe(0)
  expect(commit.status).toBe(0)
  expect(staged.stderr).toBe('')
  expect(commit.stderr).toBe('')
})

it('ignores comments and blank lines in the private word list', () => {
  const words = list('# Secret Client\n\n  \nAllowed Word\n')
  fs.writeFileSync(path.join(repo, 'example.txt'), 'Secret Client\n')
  expect(run('git', ['add', 'example.txt']).status).toBe(0)
  const message = path.join(repo, 'message.txt')
  fs.writeFileSync(message, 'Secret Client\n')

  const env = { ENSEMBLE_PRIVE_WOORDEN: words }
  expect(run('bash', [path.join(hooks, 'pre-commit')], env).status).toBe(0)
  expect(run('bash', [path.join(hooks, 'commit-msg'), message], env).status).toBe(0)
})
