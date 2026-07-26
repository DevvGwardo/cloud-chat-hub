import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  parseReviewResponse,
  resolveVerificationFilePath,
  selectPackageJsonPath,
  verifyRepoChanges,
} from '../repo-verifier'

describe('repo verifier helpers', () => {
  it('prefers the nearest package.json for changed files in nested workspaces', () => {
    expect(
      selectPackageJsonPath(
        ['client/src/App.tsx'],
        ['package.json', 'client/package.json', 'docs/package.json'],
      ),
    ).toBe('client/package.json')
  })

  it('falls back to the only discovered package.json when the changed files are outside that workspace', () => {
    expect(
      selectPackageJsonPath(
        ['README.md'],
        ['client/package.json'],
      ),
    ).toBe('client/package.json')
  })

  it('rejects verification file paths that escape the workspace', () => {
    expect(() => resolveVerificationFilePath('/tmp/workspace', '../outside.txt')).toThrow(/escapes/)
    expect(() => resolveVerificationFilePath('/tmp/workspace', '/tmp/outside.txt')).toThrow(/relative/)
  })

  it('does not write escaping file changes while applying a verification request', async () => {
    const localRepoPath = mkdtempSync(join(tmpdir(), 'repo-verifier-local-'))
    const escapedPath = join(tmpdir(), `repo-verifier-escape-${process.pid}-${Date.now()}.txt`)

    try {
      execSync('git init', { cwd: localRepoPath })
      execSync('git checkout -b main', { cwd: localRepoPath })
      execSync('git config user.email "ci@example.com"', { cwd: localRepoPath })
      execSync('git config user.name "CI"', { cwd: localRepoPath })
      writeFileSync(join(localRepoPath, 'README.md'), '# Test\n')
      execSync('git add README.md', { cwd: localRepoPath })
      execSync('git commit -m init', { cwd: localRepoPath })

      await expect(
        verifyRepoChanges({
          owner: 'octo',
          repo: 'cloudchat',
          localRepoPath,
          baseBranch: 'main',
          files: [
            {
              path: `../${basename(escapedPath)}`,
              action: 'edit',
              content: 'escaped',
            },
          ],
        }),
      ).rejects.toThrow(/escapes/)

      expect(existsSync(escapedPath)).toBe(false)
    } finally {
      rmSync(localRepoPath, { recursive: true, force: true })
      rmSync(escapedPath, { force: true })
    }
  })

  it('parses provider review JSON wrapped in markdown fences', () => {
    expect(
      parseReviewResponse([
        'Here is the review result:',
        '```json',
        '{"summary":"Needs one fix.","findings":[{"severity":"high","title":"Broken import","summary":"The import path is invalid.","file":"client/src/App.tsx"}]}',
        '```',
      ].join('\n')),
    ).toEqual({
      summary: 'Needs one fix.',
      findings: [
        {
          severity: 'high',
          title: 'Broken import',
          summary: 'The import path is invalid.',
          file: 'client/src/App.tsx',
        },
      ],
    })
  })
})
