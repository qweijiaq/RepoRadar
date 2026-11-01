import type { RepoInput, Verdict } from '../src/types.js'

export interface EnrichEvalCase {
  name: string
  repo: Partial<RepoInput> & Pick<RepoInput, 'fullName'>
  readme: string | null
  allowedVerdicts: Verdict[]
  minQuality?: number
  maxQuality?: number
  note?: string
}

const recent = '2026-10-28T00:00:00Z'

export const enrichEvalCases: EnrichEvalCase[] = [
  {
    name: 'solid-typescript-cli',
    repo: {
      fullName: 'acme/solid-cli',
      description: 'A TypeScript CLI for converting Markdown into static documentation.',
      language: 'TypeScript',
      topics: ['cli', 'markdown', 'documentation'],
      stars: 420,
      license: 'MIT',
      pushedAt: recent,
      createdAt: '2024-06-01T00:00:00Z',
    },
    readme: `# Solid CLI

Convert Markdown into a static documentation site.

## Install

\`\`\`bash
npm install -g solid-cli
\`\`\`

## Usage

Run \`solid build ./docs\` to generate HTML. The project has tests, CI, and a documented API.`,
    allowedVerdicts: ['recommend', 'neutral'],
    minQuality: 0.55,
  },
  {
    name: 'empty-readme',
    repo: {
      fullName: 'acme/empty',
      description: null,
      language: null,
      topics: [],
      stars: 0,
      license: null,
      pushedAt: '2023-01-01T00:00:00Z',
      createdAt: '2022-01-01T00:00:00Z',
    },
    readme: null,
    allowedVerdicts: ['skip', 'neutral'],
    maxQuality: 0.8,
  },
  {
    name: 'awesome-list',
    repo: {
      fullName: 'acme/awesome-tools',
      description: 'A curated list of tools.',
      language: 'Markdown',
      topics: ['awesome-list'],
      stars: 12000,
      license: 'CC0-1.0',
      pushedAt: recent,
      createdAt: '2020-01-01T00:00:00Z',
    },
    readme: `# Awesome Tools

A curated list of links. This is not a library and contains no code.

- [Tool A](https://example.com/a)
- [Tool B](https://example.com/b)`,
    allowedVerdicts: ['skip', 'neutral'],
    maxQuality: 0.85,
    note: '清单类仓库不应被当成可直接接入的库。',
  },
  {
    name: 'archived-project',
    repo: {
      fullName: 'acme/archived',
      description: 'An old wrapper around a deprecated API.',
      language: 'JavaScript',
      topics: ['legacy'],
      stars: 80,
      license: 'MIT',
      archived: true,
      pushedAt: '2022-01-01T00:00:00Z',
      createdAt: '2020-01-01T00:00:00Z',
    },
    readme: `# Archived

This project is archived and no longer maintained. It depends on an API that was shut down.`,
    allowedVerdicts: ['skip', 'neutral'],
    maxQuality: 0.8,
  },
  {
    name: 'young-clear-tool',
    repo: {
      fullName: 'acme/new-tool',
      description: 'A small, focused CLI for inspecting SQLite databases.',
      language: 'Rust',
      topics: ['cli', 'sqlite'],
      stars: 35,
      license: 'Apache-2.0',
      pushedAt: recent,
      createdAt: '2026-08-01T00:00:00Z',
    },
    readme: `# New Tool

Inspect SQLite databases from the terminal.

## Install

\`\`\`bash
cargo install new-tool
\`\`\`

## Features

- List tables and indexes
- Explain query plans
- Export JSON

The repository includes tests and a short usage guide.`,
    allowedVerdicts: ['recommend', 'neutral'],
    minQuality: 0.4,
  },
  {
    name: 'vague-readme',
    repo: {
      fullName: 'acme/vague',
      description: 'A powerful next-generation platform.',
      language: 'Go',
      topics: ['platform'],
      stars: 300,
      license: 'MIT',
      pushedAt: recent,
      createdAt: '2024-01-01T00:00:00Z',
    },
    readme: `# Vague

A powerful next-generation platform for modern teams. It is fast, scalable and easy to use.`,
    allowedVerdicts: ['neutral', 'skip'],
    maxQuality: 0.85,
  },
]
