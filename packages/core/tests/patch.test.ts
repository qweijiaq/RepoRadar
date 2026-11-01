import { describe, expect, it } from 'vitest'
import { buildPullRequestBrief, parseGeneratedPatch, selectPatchFiles } from '../src/patch.js'
import type { IssueContext } from '../src/issue-plan.js'

const issue: IssueContext = {
  repo: 'acme/widget',
  number: 7,
  title: 'Crash when parsing empty config',
  body: 'src/config.ts throws on empty input',
  labels: ['bug'],
  author: 'alice',
  comments: [],
  files: ['src/config.ts', 'src/config.test.ts', 'README.md', 'src/server.ts'],
}

const validPatch = `diff --git a/src/config.ts b/src/config.ts
index 1111111..2222222 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,2 +1,2 @@
-export const parse = (value: string) => JSON.parse(value)
+export const parse = (value: string) => value.trim() ? JSON.parse(value) : {}
`

describe('parseGeneratedPatch', () => {
  it('parses a JSON object containing a unified diff', () => {
    const patch = parseGeneratedPatch(
      JSON.stringify({ summary: 'Treat empty input as empty config.', files: ['src/config.ts'], patch: validPatch }),
    )
    expect(patch.files).toEqual(['src/config.ts'])
    expect(patch.patch).toContain('diff --git a/src/config.ts')
  })

  it('strips markdown fences around the diff', () => {
    const fenced = `\`\`\`diff\n${validPatch}\`\`\``
    const patch = parseGeneratedPatch(JSON.stringify({ summary: 'Fix empty config handling.', patch: fenced }))
    expect(patch.patch.startsWith('diff --git')).toBe(true)
  })

  it('rejects a response that is not a diff', () => {
    expect(() =>
      parseGeneratedPatch(JSON.stringify({ summary: 'Here is the fix.', patch: 'just change line 2' })),
    ).toThrow(/不符合要求|unified diff/)
  })
})

describe('selectPatchFiles', () => {
  it('prefers files named in the issue plan', () => {
    const files = selectPatchFiles(
      issue,
      {
        summary: 'Config parsing needs a guard.',
        likelyFiles: ['src/server.ts'],
        steps: ['guard', 'test'],
        tests: [],
        risks: [],
        acceptance: [],
      },
      issue.files,
    )
    expect(files[0]).toBe('src/server.ts')
    expect(files).toContain('src/config.ts')
  })
})


describe('buildPullRequestBrief', () => {
  it('builds a copyable PR title and body without pushing anything', () => {
    const brief = buildPullRequestBrief({
      id: 1,
      repo: 'acme/widget',
      issueNumber: 7,
      title: 'Crash when parsing empty config',
      summary: 'Treat empty input as an empty config object.\nAdds a regression test.',
      patch: validPatch,
      files: ['src/config.ts'],
      validation: { applies: true, buildStatus: 'verified', commands: [], changedFiles: ['src/config.ts'], logTail: '' },
      status: 'validated',
      createdAt: '2026-11-01T00:00:00.000Z',
    })
    expect(brief).toContain('Title: fix: Treat empty input')
    expect(brief).toContain('Closes #7')
    expect(brief).toContain('- 补丁应用：通过')
    expect(brief).toContain('- 构建 / 测试：verified')
    expect(brief).not.toContain('git push')
  })
})
