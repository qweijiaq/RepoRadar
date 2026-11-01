import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx', 'apps/worker/src/mcp-server.ts'],
  cwd: process.cwd(),
  stderr: 'inherit',
})

const client = new Client({ name: 'repo-radar-check', version: '0.0.0' })
await client.connect(transport)

const tools = await client.listTools()
console.log('TOOLS:', tools.tools.map((tool) => tool.name).join(', '))

const recommendations = await client.callTool({
  name: 'get_recommendations',
  arguments: { login: 'demo', limit: 3 },
})
console.log('\nRECOMMENDATIONS:', recommendations.content[0].text.slice(0, 400))

const search = await client.callTool({
  name: 'search_repos',
  arguments: { query: 'agent', limit: 2 },
})
console.log('\nSEARCH:', search.content[0].text.slice(0, 300))

const digest = await client.callTool({
  name: 'get_digest',
  arguments: { login: 'demo', limit: 2 },
})
console.log('\nDIGEST:', digest.content[0].text.slice(0, 300))

const pick = await client.callTool({
  name: 'pick_library',
  arguments: { task: 'structured logging for a Next.js app', language: 'TypeScript', limit: 2 },
})
console.log('\nPICK_LIBRARY:', pick.content[0].text.slice(0, 300))

const diff = await client.callTool({
  name: 'similar_diff',
  arguments: { project: 'demo/app', login: 'demo' },
})
console.log('\nSIMILAR_DIFF:', diff.content[0].text.slice(0, 200))

const status = await client.callTool({
  name: 'get_job_status',
  arguments: { jobId: 999999, login: 'demo' },
})
console.log('\nJOB_STATUS:', status.content[0].text.slice(0, 160))

await client.close()
