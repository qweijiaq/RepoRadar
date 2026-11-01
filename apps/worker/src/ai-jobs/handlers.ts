import {
  addNotification,
  buildDiscoveryQueries,
  buildFeedbackContext,
  checkProjectDependencies,
  diversifyRanking,
  deriveWatchSearchQueries,
  filterIntegrationProjects,
  loadHandledState,
  watchMatchHandled,
  fetchIssueContext,
  fetchRepo,
  fetchMaintainerSnapshot,
  enrichPendingRepos,
  fetchReadme,
  fetchRepoFile,
  loadDiscoveryStatus,
  runDiscovery,
  findEnrichedRepos,
  findLatestIntegrationReport,
  findLatestIssuePlan,
  findRepoByFullName,
  findReposForMatching,
  findUserById,
  findWatchIntent,
  generateComparisonReport,
  generateDiscoverabilityReport,
  generateIntegrationReport,
  countCodeChunks,
  generateIntegrationTrial,
  getSymbolSplitter,
  indexRepoCode,
  searchCodeChunks,
  buildMechanicalSwapPatch,
  generateSwapTrial,
  generateIssuePlan,
  generateMaintainerReport,
  generatePatch,
  deriveSimilarProjectKeywords,
  generateSimilarReport,
  generateWatchMatches,
  GitHubApiError,
  keywordCoverage,
  repoSimilarity,
  textSimilarity,
  isDependencyUsed,
  listFeedbackSignals,
  listIntegrationOutcomes,
  listUserGithubTokens,
  listUserProjects,
  loadConfig,
  loadFeedback,
  loadStoredLlmConfig,
  loadSubscriptions,
  PROMPT_VERSIONS,
  rankForUser,
  saveComparisonReport,
  saveDiscoverabilityReport,
  saveIntegrationReport,
  saveIssuePlan,
  saveMaintainerReport,
  savePatchDraft,
  saveSimilarReport,
  runDependencyUpgrade,
  saveWatchMatches,
  saveWatchRun,
  searchRepos,
  selectPatchFiles,
  syncRepoActivity,
  updateJobProgress,
  upsertRepo,
  validatePatch,
  type DbPool,
  type IntegrationTrialCandidate,
  type JobRecord,
  type JobResult,
  type LlmConfig,
} from '@repo-radar/core'
import {
  decryptJobToken,
  fetchGitHubRepo,
  generateIssueForUser,
  loadProjectContext,
  saveIssueDraft,
} from '@repo-radar/core'

type Progress = (message: string) => Promise<void>

function requireToken(job: JobRecord): string {
  const token = decryptJobToken(job.payload.token)
  if (!token) throw new Error('GitHub 授权不可用，请重新登录后再试')
  return token
}

async function loadLlm(pool: DbPool): Promise<LlmConfig> {
  const llm = loadConfig().llm ?? (await loadStoredLlmConfig(pool))
  if (!llm) throw new Error('还没有配置 AI 模型，请先到设置页配置')
  return llm
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function integrationJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  let token = decryptJobToken(job.payload.token)
  if (!token) {
    const stored = await listUserGithubTokens(pool)
    token = stored.find((entry) => entry.userId === userId)?.token ?? stored[0]?.token ?? null
  }
  const focus = job.payload.focus ?? null

  const projects = await listUserProjects(pool, userId)
  const requestedProjects = job.payload.projects ?? []
  let selected =
    requestedProjects.length > 0
      ? projects.filter((project) =>
          requestedProjects.some(
            (requested) => requested.toLowerCase() === project.repoFullName.toLowerCase(),
          ),
        )
      : projects.filter((project) => project.active)
  let auto = false
  if (selected.length === 0 && requestedProjects.length === 0) {
    selected = projects.filter((project) => project.source === 'owned').slice(0, 5)
    auto = selected.length > 0
  }
  if (selected.length === 0) {
    throw new Error(
      requestedProjects.length > 0
        ? '指定的项目不在你的项目列表里'
        : '还没有可分析的项目',
    )
  }
  selected = [...selected]
    .sort(
      (left, right) =>
        Date.parse(right.lastPushedAt ?? '') - Date.parse(left.lastPushedAt ?? ''),
    )
    .slice(0, 5)

  await progress('读取项目上下文…')
  const contexts = await Promise.all(selected.map((project) => loadProjectContext(project.repoFullName, token)))
  const [feedback, signals, subscriptions, user, repos, outcomes] = await Promise.all([
    loadFeedback(pool, userId),
    listFeedbackSignals(pool, userId),
    loadSubscriptions(pool, userId),
    findUserById(pool, userId),
    findEnrichedRepos(pool, 500),
    listIntegrationOutcomes(pool, userId),
  ])

  const projectNames = new Set(selected.map((project) => project.repoFullName))
  const dependencies = [...new Set(contexts.flatMap((item) => item.dependencies))]
  const ranked = rankForUser(
    user?.profile ?? null,
    repos.filter((repo) => !projectNames.has(repo.fullName)),
    Date.now(),
    buildFeedbackContext(feedback, signals),
    subscriptions,
  )
  const diverse = diversifyRanking(ranked, { limit: 70, maxPerTopic: 4, maxPerLanguage: 30 })
  const diverseNames = new Set(diverse.map((repo) => repo.fullName))
  const verifiedExtras = ranked
    .filter((repo) => repo.verifyStatus === 'verified' && !diverseNames.has(repo.fullName))
    .slice(0, 20)
  const candidateMap = new Map<string, ReturnType<typeof buildIntegrationCandidate>>()
  for (const repo of [...diverse, ...verifiedExtras]) {
    candidateMap.set(repo.fullName, buildIntegrationCandidate(repo, dependencies))
  }

  let tokenInvalid = false
  if (token) {
    await progress('搜索可作为补充的候选…')
    for (const query of buildDiscoveryQueries(contexts)) {
      if (candidateMap.size >= 100) break
      try {
        const found = await searchRepos(query, { token, perPage: 20 })
        for (const repo of found) {
          if (projectNames.has(repo.fullName) || candidateMap.has(repo.fullName)) continue
          await upsertRepo(pool, repo)
          candidateMap.set(repo.fullName, {
            repo: repo.fullName,
            summary: repo.description ?? '',
            language: repo.language,
            topics: repo.topics,
            stars: repo.stars,
            verified: false,
            reason: 'GitHub 搜索发现',
            alreadyUsed: isDependencyUsed(repo.fullName, dependencies),
          })
          if (candidateMap.size >= 100) break
        }
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 401) tokenInvalid = true
        console.error('[job:integration] 候选搜索失败：', error)
      }
      await sleep(350)
    }
  }

  const candidates = [...candidateMap.values()]
  if (candidates.length === 0) throw new Error('没有可用的候选仓库')
  await progress('模型生成中…')
  const report = await generateIntegrationReport(contexts, candidates, llm, focus, outcomes)
  const reportId = await saveIntegrationReport(pool, userId, {
    report,
    usedProjects: selected.map((project) => project.repoFullName),
    auto,
    focus,
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.integration,
    candidateCount: candidates.length,
    candidateRepos: candidates.map((candidate) => candidate.repo),
  })
  await addNotification(pool, userId, {
    kind: 'integration',
    title: '接入建议已生成',
    body: `${report.projects.map((project) => project.repo).join('、')}${
      tokenInvalid ? '（GitHub 授权已失效，本轮未使用实时搜索，请重新登录）' : ''
    }`,
    url: `/workbench/integrations?report=${reportId}`,
  })
  return { href: `/workbench/integrations?report=${reportId}`, label: '查看接入建议' }
}

function buildIntegrationCandidate(
  repo: Awaited<ReturnType<typeof findEnrichedRepos>>[number],
  dependencies: string[],
) {
  return {
    repo: repo.fullName,
    summary: repo.summary ?? repo.description ?? '',
    language: repo.language,
    topics: repo.topics,
    stars: repo.stars,
    verified: repo.verifyStatus === 'verified',
    reason: repo.reason,
    alreadyUsed: dependencies.some((dependency) => {
      const normalized = dependency.toLowerCase().replace(/^@/, '')
      return (
        normalized === repo.fullName.toLowerCase() ||
        normalized === repo.name.toLowerCase()
      )
    }),
  }
}

async function maintainerJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const handled = await loadHandledState(pool, userId)
  const isBlocked = (key: string) =>
    handled.done.has(key.toLowerCase()) || handled.dismissed.has(key.toLowerCase())
  const projects = await listUserProjects(pool, userId)
  let selected = projects.filter((project) => project.active)
  if (selected.length === 0) selected = projects.filter((project) => project.source === 'owned')
  selected = selected.slice(0, 5)
  if (selected.length === 0) throw new Error('还没有可分析的项目')

  const inputs = []
  const warnings: string[] = []
  for (const project of selected) {
    await progress(`读取 ${project.repoFullName}…`)
    const context = await loadProjectContext(project.repoFullName, token)
    const [snapshot, dependencies] = await Promise.all([
      fetchMaintainerSnapshot(token, project.repoFullName),
      checkProjectDependencies(context.manifestName, context.manifest, {
          token,
          limit: 12,
          lockfile:
            context.lockfileName && context.lockfile
              ? { name: context.lockfileName, content: context.lockfile }
              : null,
        }),
    ])
    warnings.push(...snapshot.warnings)
    if (dependencies.supported && dependencies.note) warnings.push(`${project.repoFullName}：${dependencies.note}`)
    inputs.push({
      repo: project.repoFullName,
      description: context.description,
      language: context.language,
      topics: context.topics,
      readme: context.readme,
      manifestName: context.manifestName,
      manifest: context.manifest,
      dependencies: dependencies.items.filter(
        (dependency) =>
          !isBlocked(
            `dependency:${project.repoFullName}:${dependency.name}:${dependency.latest ?? 'unknown'}`,
          ),
      ),
      signals: {
        ...snapshot.signals,
        hasTests:
          snapshot.signals.hasTests ||
          /"(test|vitest|jest|pytest)"\s*:/.test(context.manifest ?? '') ||
          /pytest|vitest|jest/i.test(context.manifest ?? ''),
      },
      items: snapshot.items.filter(
        (item) =>
          !isBlocked(`maintainer:${project.repoFullName}:${item.kind}:${item.number}`),
      ),
    })
  }

  await progress('模型生成维护周报…')
  const report = await generateMaintainerReport(inputs, llm)
  const reportId = await saveMaintainerReport(pool, userId, {
    report,
    usedProjects: selected.map((project) => project.repoFullName),
    warnings: [...new Set(warnings)],
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.maintainer,
  })
  await addNotification(pool, userId, {
    kind: 'maintainer',
    title: '维护周报已生成',
    body: report.projects.map((project) => project.repo).join('、'),
    url: `/workbench/maintain?report=${reportId}`,
  })
  return { href: `/workbench/maintain?report=${reportId}`, label: '查看维护周报' }
}

async function issueJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  await progress('生成技术周报…')
  const generated = await generateIssueForUser(userId, llm)
  const draftId = await saveIssueDraft(pool, {
    userId,
    ...generated,
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.issue,
  })
  await addNotification(pool, userId, {
    kind: 'issue',
    title: '新一期周报已生成',
    body: generated.title,
    url: `/workbench/issue?draft=${draftId}`,
  })
  return { href: `/workbench/issue?draft=${draftId}`, label: '查看技术周报' }
}

async function discoverabilityJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const repo = job.payload.repo?.trim()
  if (!repo) throw new Error('缺少仓库参数')
  await progress('读取仓库与 README…')
  const fetched = await fetchGitHubRepo(repo, token)
  if (!fetched) throw new Error('没有找到这个仓库')
  const user = await findUserById(pool, userId)
  if (user && fetched.owner.toLowerCase() !== user.login.toLowerCase()) throw new Error('只能分析自己拥有的仓库')
  const readme = await fetchReadme(repo, token)
  await progress('模型分析可发现性…')
  const report = await generateDiscoverabilityReport(
    {
      repo,
      description: fetched.description ?? '',
      topics: fetched.topics,
      readme,
      language: fetched.language,
      stars: fetched.stars,
      forks: fetched.forks,
      openIssues: fetched.openIssues,
      homepage: fetched.homepage,
      license: fetched.license,
      pushedAt: fetched.pushedAt,
    },
    llm,
  )
  const reportId = await saveDiscoverabilityReport(pool, userId, {
    report,
    repo,
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.discoverability,
  })
  await addNotification(pool, userId, {
    kind: 'discoverability',
    title: '曝光优化报告已生成',
    body: repo,
    url: `/repos/${repo}/optimize?report=${reportId}`,
  })
  return { href: `/repos/${repo}/optimize?report=${reportId}`, label: '查看曝光优化' }
}

async function comparisonJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const project = job.payload.project?.trim()
  if (!project) throw new Error('缺少项目参数')
  await progress('读取项目与候选…')
  const handled = await loadHandledState(pool, userId)
  const blockedCandidate = (repo: string) => {
    const pair = `${project}|${repo}`.toLowerCase()
    if (handled.outcomes.has(pair)) return true
    const key = `integration:${project}:${repo}`.toLowerCase()
    return handled.done.has(key) || handled.dismissed.has(key)
  }
  const explicit = [...new Set(job.payload.candidates ?? [])]
    .filter((repo) => !blockedCandidate(repo))
    .slice(0, 5)
  let suggestionRepos: string[] = explicit
  if (suggestionRepos.length < 2) {
    const latest = await findLatestIntegrationReport(pool, userId)
    const filtered = latest
      ? {
          ...latest,
          report: {
            ...latest.report,
            projects: filterIntegrationProjects(latest.report.projects, handled),
          },
        }
      : null
    const projectReport = filtered?.report.projects.find(
      (item) => item.repo.toLowerCase() === project.toLowerCase(),
    )
    suggestionRepos = [
      ...new Set(projectReport?.suggestions.map((suggestion) => suggestion.repo) ?? []),
    ].slice(0, 5)
  }
  if (suggestionRepos.length < 2) throw new Error('对比至少需要 2 个候选，请先在建议库选择')

  const context = await loadProjectContext(project, token)
  const candidates = []
  for (const repo of suggestionRepos.slice(0, 5)) {
    const candidateContext = await loadProjectContext(repo, token)
    const record = await findRepoByFullName(pool, repo)
    candidates.push({
      repo,
      summary: candidateContext.description || record?.description || '',
      language: candidateContext.language ?? record?.language ?? null,
      topics: candidateContext.topics.length > 0 ? candidateContext.topics : (record?.topics ?? []),
      stars: record?.stars ?? 0,
      readme: candidateContext.readme,
    })
  }

  await progress('模型生成选型对比…')
  const report = await generateComparisonReport(
    {
      repo: project,
      description: context.description,
      language: context.language,
      topics: context.topics,
      dependencies: context.dependencies,
      readme: context.readme,
      manifestName: context.manifestName,
      manifest: context.manifest,
    },
    candidates,
    llm,
  )
  const reportId = await saveComparisonReport(pool, userId, project, {
    report,
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.comparison,
    candidateRepos: candidates.map((candidate) => candidate.repo),
  })
  await addNotification(pool, userId, {
    kind: 'comparison',
    title: '选型对比已生成',
    body: `${project}：${report.recommendation.repo}`,
    url: `/compare?project=${encodeURIComponent(project)}&report=${reportId}`,
  })
  return { href: `/compare?project=${encodeURIComponent(project)}&report=${reportId}`, label: '查看选型对比' }
}

async function issuePlanJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const repo = job.payload.repo?.trim()
  const issueNumber = Number(job.payload.issueNumber)
  if (!repo || !Number.isFinite(issueNumber)) throw new Error('缺少 Issue 参数')
  await progress('读取 Issue 与仓库文件…')
  const issue = await fetchIssueContext(token, repo, issueNumber)
  if (!issue) throw new Error('没有找到这个 Issue')
  const project = await loadProjectContext(repo, token)
  await progress('模型生成修复方案…')
  const plan = await generateIssuePlan(issue, project, llm)
  const planId = await saveIssuePlan(pool, userId, {
    plan,
    repo,
    issueNumber,
    issueTitle: issue.title,
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS['issue-plan'],
  })
  await addNotification(pool, userId, {
    kind: 'issue-plan',
    title: 'Issue 修复方案已生成',
    body: `${repo} #${issueNumber}：${issue.title}`,
    url: `/issue-plan?repo=${encodeURIComponent(repo)}&number=${issueNumber}&plan=${planId}`,
  })
  return {
    href: `/issue-plan?repo=${encodeURIComponent(repo)}&number=${issueNumber}&plan=${planId}`,
    label: '查看修复方案',
  }
}

async function discoveryJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const config = loadConfig()
  let token = decryptJobToken(job.payload.token) ?? config.githubToken ?? null
  if (!token) {
    const stored = await listUserGithubTokens(pool)
    token = stored[0]?.token ?? null
  }
  const topics = (job.payload.topics?.length ? job.payload.topics : config.search.topics)
    .map((topic) => topic.trim())
    .filter(Boolean)
  const llm = config.llm ?? (await loadStoredLlmConfig(pool))
  const enrichLimit = Math.max(1, Math.min(50, Number(job.payload.enrichLimit) || 20))

  await progress(`采集 ${topics.length} 个主题的候选仓库…`)
  const run = await runDiscovery(pool, {
    topics,
    token,
    llm,
    pages: 1,
    perPage: 30,
    enrichLimit,
    delayMs: 2200,
    sort: 'updated',
    freshDays: 120,
    onProgress: progress,
  })
  const status = await loadDiscoveryStatus(pool)
  await addNotification(pool, userId, {
    kind: 'discover',
    title: '候选池已更新',
    body: `新增 ${run.inserted} 个仓库，富化 ${run.enriched} 个；当前 ${status.enrichedRepos} 个已富化。`,
    url: '/settings?pool=updated',
  })
  return {
    href: '/settings?pool=updated',
    label: `候选池：新增 ${run.inserted}，富化 ${run.enriched}`,
  }
}

async function patchJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const repo = job.payload.repo?.trim()
  const issueNumber = Number(job.payload.issueNumber)
  if (!repo || !Number.isFinite(issueNumber) || issueNumber <= 0) throw new Error('缺少 Issue 参数')

  await progress('读取 Issue 与相关文件…')
  const issue = await fetchIssueContext(token, repo, issueNumber)
  if (!issue) throw new Error('没有找到这个 Issue')
  const [plan, project] = await Promise.all([
    findLatestIssuePlan(pool, userId, repo, issueNumber),
    loadProjectContext(repo, token),
  ])
  const paths = selectPatchFiles(issue, plan?.plan ?? null, issue.files)
  const loaded = await Promise.all(paths.map((path) => fetchRepoFile(repo, path, token)))
  const files = loaded.filter((file): file is NonNullable<typeof file> => Boolean(file))
  if (files.length === 0) throw new Error('没有读到可修改的文件，仓库可能太大或文件不可访问')

  await progress(`模型生成补丁（${files.length} 个文件）…`)
  const generated = await generatePatch(issue, project, plan?.plan ?? null, files, llm)

  await progress('在 Docker 沙箱验证补丁…')
  const validation = await validatePatch({
    repoFullName: repo,
    patch: generated.patch,
    token,
    timeoutMs: 300_000,
  })
  const succeeded =
    validation.applies &&
    (validation.buildStatus === 'verified' || validation.buildStatus === 'skipped')
  const patchId = await savePatchDraft(pool, userId, {
    repo,
    issueNumber,
    title: `${repo} #${issueNumber} 修复补丁`,
    summary: generated.summary,
    patch: generated.patch,
    files: validation.changedFiles.length > 0 ? validation.changedFiles : generated.files,
    validation,
    status: succeeded ? 'validated' : 'failed',
  })

  await addNotification(pool, userId, {
    kind: 'patch',
    title: succeeded ? '修复补丁已验证' : '修复补丁验证未通过',
    body: `${repo} #${issueNumber}：${generated.summary.slice(0, 120)}`,
    url: `/patch/${patchId}`,
  })

  return {
    href: `/patch/${patchId}`,
    label: succeeded ? '查看已验证补丁' : '查看补丁与验证日志',
  }
}

async function integrationTrialJob(
  pool: DbPool,
  userId: number,
  job: JobRecord,
  progress: Progress,
): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const project = job.payload.project?.trim()
  const candidateName = job.payload.repo?.trim()
  if (!project || !candidateName) throw new Error('缺少项目或候选仓库')

  await progress('读取项目上下文…')
  const projectContext = await loadProjectContext(project, token)
  const enriched = await findRepoByFullName(pool, candidateName)
  const basic = enriched ? null : await fetchRepo(candidateName, token)
  if (!enriched && !basic) throw new Error('没有找到候选仓库')

  const candidate: IntegrationTrialCandidate = {
    repo: candidateName,
    summary: enriched?.summary ?? enriched?.description ?? basic?.description ?? '',
    language: enriched?.language ?? basic?.language ?? null,
    topics: enriched?.topics ?? basic?.topics ?? [],
    stars: enriched?.stars ?? basic?.stars ?? 0,
  }

  const targetPath = job.payload.file?.trim()
  const targetFile = targetPath ? await fetchRepoFile(project, targetPath, token) : null
  if (targetPath && !targetFile) {
    await progress(`没有读到 ${targetPath}，改为只修改依赖清单`)
  }

  let codeEvidence: Array<{ path: string; content: string }> = []
  try {
    if ((await countCodeChunks(pool, candidateName)) === 0) {
      await progress('索引候选仓库的入口代码…')
      await indexRepoCode(pool, candidateName, {
        token,
        llm,
        maxFiles: 8,
        symbolSplitter: getSymbolSplitter(),
      })
    }
    const query = [candidate.summary, ...(job.payload.steps ?? []), project].join(' ')
    codeEvidence = await searchCodeChunks(pool, candidateName, query, { llm, limit: 3 })
  } catch (error) {
    console.error('[integration-trial] code evidence failed:', error)
  }

  await progress('模型生成试接入补丁…')
  const generated = await generateIntegrationTrial(
    {
      project,
      candidate,
      projectContext,
      steps: job.payload.steps ?? [],
      targetFile: targetFile ? { path: targetFile.path, content: targetFile.content } : null,
      codeEvidence,
    },
    llm,
  )

  await progress('在 Docker 沙箱验证接入补丁…')
  const validation = await validatePatch({
    repoFullName: project,
    patch: generated.patch,
    token,
    timeoutMs: 300_000,
  })
  const succeeded =
    validation.applies &&
    (validation.buildStatus === 'verified' || validation.buildStatus === 'skipped')

  const patchId = await savePatchDraft(pool, userId, {
    repo: project,
    kind: 'integration',
    issueNumber: null,
    title: `接入预演：${project} ← ${candidateName}`,
    summary: generated.summary,
    patch: generated.patch,
    files: validation.changedFiles.length > 0 ? validation.changedFiles : generated.files,
    validation,
    status: succeeded ? 'validated' : 'failed',
  })

  await addNotification(pool, userId, {
    kind: 'patch',
    title: succeeded ? '接入预演通过' : '接入预演未通过',
    body: `${project} ← ${candidateName}：${generated.summary.slice(0, 120)}`,
    url: `/patch/${patchId}`,
  })

  return {
    href: `/patch/${patchId}`,
    label: succeeded ? '查看试接入结果' : '查看补丁与验证日志',
  }
}

async function swapTrialJob(
  pool: DbPool,
  userId: number,
  job: JobRecord,
  progress: Progress,
): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const token = requireToken(job)
  const project = job.payload.project?.trim()
  const fromPackage = job.payload.fromPackage?.trim()
  const toPackage = job.payload.toPackage?.trim()
  if (!project || !fromPackage || !toPackage) throw new Error('缺少项目或包名')

  await progress('读取项目上下文…')
  const projectContext = await loadProjectContext(project, token)
  const targetPath = job.payload.file?.trim()
  const targetFile = targetPath ? await fetchRepoFile(project, targetPath, token) : null
  if (targetPath && !targetFile) await progress(`没有读到 ${targetPath}，改为只修改依赖清单`)

  let generated: { summary: string; files: string[]; patch: string }
  if (job.payload.mode === 'mechanical') {
    await progress(`机械替换 ${fromPackage} → ${toPackage}…`)
    const built = buildMechanicalSwapPatch({
      manifestName: projectContext.manifestName,
      manifest: projectContext.manifest,
      targetFile: targetFile ? { path: targetFile.path, content: targetFile.content } : null,
      fromPackage,
      toPackage,
    })
    if (!built) {
      throw new Error('没有可机械替换的内容：需要 package.json 依赖或目标文件里的 import')
    }
    generated = built
  } else {
    await progress(`模型生成换库补丁（${fromPackage} → ${toPackage}）…`)
    generated = await generateSwapTrial(
      {
        project,
        projectContext,
        fromPackage,
        toPackage,
        targetFile: targetFile ? { path: targetFile.path, content: targetFile.content } : null,
      },
      llm,
    )
  }

  await progress('在 Docker 沙箱验证换库补丁…')
  const validation = await validatePatch({
    repoFullName: project,
    patch: generated.patch,
    token,
    timeoutMs: 300_000,
  })
  const succeeded =
    validation.applies &&
    (validation.buildStatus === 'verified' || validation.buildStatus === 'skipped')

  const patchId = await savePatchDraft(pool, userId, {
    repo: project,
    kind: 'swap',
    issueNumber: null,
    title: `换库预演：${project} ${fromPackage} → ${toPackage}`,
    summary: generated.summary,
    patch: generated.patch,
    files: validation.changedFiles.length > 0 ? validation.changedFiles : generated.files,
    validation,
    status: succeeded ? 'validated' : 'failed',
  })

  await addNotification(pool, userId, {
    kind: 'patch',
    title: succeeded ? '换库预演通过' : '换库预演未通过',
    body: `${project}：${fromPackage} → ${toPackage}`,
    url: `/patch/${patchId}`,
  })

  return {
    href: `/patch/${patchId}`,
    label: succeeded ? '查看换库结果' : '查看补丁与验证日志',
  }
}

async function upgradeJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const repo = job.payload.repo?.trim()
  const packageName = job.payload.packageName?.trim()
  const targetVersion = job.payload.targetVersion?.trim()
  const currentVersion = job.payload.currentVersion?.trim() || null
  if (!repo || !packageName || !targetVersion) throw new Error('缺少依赖升级参数')
  const token = requireToken(job)

  await progress(`在 Docker 沙箱升级 ${packageName} 到 ${targetVersion}…`)
  const result = await runDependencyUpgrade({
    repoFullName: repo,
    packageName,
    targetVersion,
    token,
    timeoutMs: 420_000,
  })
  const succeeded =
    result.applied &&
    result.buildStatus !== 'failed' &&
    result.buildStatus !== 'error'
  const summary = `${packageName} ${currentVersion ? `${currentVersion} → ` : ''}${targetVersion}；${
    result.buildStatus === 'verified'
      ? '构建/测试通过'
      : result.buildStatus === 'skipped'
        ? '未执行完整构建'
        : '构建/测试未通过'
  }${result.error ? `：${result.error}` : ''}`
  const patchId = await savePatchDraft(pool, userId, {
    repo,
    issueNumber: null,
    title: `依赖升级 · ${packageName} ${targetVersion}`,
    summary,
    patch: result.patch || `# 没有生成文件改动
# ${result.error ?? ''}
`,
    files: result.changedFiles,
    validation: {
      applies: result.applied,
      buildStatus: result.buildStatus,
      commands: result.commands,
      changedFiles: result.changedFiles,
      logTail: result.logTail,
      ...(result.error ? { error: result.error } : {}),
    },
    status: succeeded ? 'validated' : 'failed',
  })

  await addNotification(pool, userId, {
    kind: 'upgrade',
    title: succeeded ? '依赖升级补丁已生成' : '依赖升级验证未通过',
    body: `${repo}：${summary.slice(0, 140)}`,
    url: `/patch/${patchId}`,
  })

  return {
    href: `/patch/${patchId}`,
    label: succeeded ? '查看升级补丁' : '查看升级结果',
  }
}

async function watchJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const intentId = Number(job.payload.intentId)
  if (!Number.isFinite(intentId)) throw new Error('缺少关注意图')
  const intent = await findWatchIntent(pool, userId, intentId)
  if (!intent) throw new Error('关注意图不存在')
  let token = decryptJobToken(job.payload.token)
  if (!token) {
    const stored = await listUserGithubTokens(pool)
    token = stored.find((entry) => entry.userId === userId)?.token ?? stored[0]?.token ?? null
  }
  await progress('从候选池筛选匹配…')
  const repos = await findEnrichedRepos(pool, 140)
  const candidateMap = new Map(
    repos.map((repo) => [
      repo.fullName.toLowerCase(),
      {
        repo: repo.fullName,
        summary: (repo.summary ?? repo.description ?? '').slice(0, 120),
        language: repo.language,
        topics: repo.topics,
        stars: repo.stars,
      },
    ]),
  )

  if (token) {
    await progress('提取关键词并搜索 GitHub…')
    const queries = await deriveWatchSearchQueries(intent.text, llm)
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
    for (const query of queries) {
      if (candidateMap.size >= 160) break
      try {
        const found = await searchRepos(
          `${query} stars:>=50 pushed:>=${since} archived:false fork:false`,
          { token, perPage: 10 },
        )
        for (const repo of found) {
          if (candidateMap.has(repo.fullName.toLowerCase())) continue
          await upsertRepo(pool, repo)
          candidateMap.set(repo.fullName.toLowerCase(), {
            repo: repo.fullName,
            summary: (repo.description ?? '').slice(0, 120),
            language: repo.language,
            topics: repo.topics,
            stars: repo.stars,
          })
          if (candidateMap.size >= 160) break
        }
      } catch (error) {
        if (!(error instanceof GitHubApiError && error.status === 401)) {
          console.error('[job:watch] GitHub 搜索失败：', error)
        }
      }
      await sleep(300)
    }
  }

  const candidates = [...candidateMap.values()]
  if (candidates.length === 0) throw new Error('候选池为空，请先运行采集和富化')
  await progress('模型判断匹配度…')
  const matches = await generateWatchMatches(intent.text, candidates, llm)
  const handled = await loadHandledState(pool, userId)
  const activeMatches = matches.filter(
    (match) => !watchMatchHandled(intent.id, match.repo, handled),
  )
  await saveWatchMatches(pool, intent.id, activeMatches)
  await saveWatchRun(pool, intent.id, {
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.watch,
    matchCount: activeMatches.length,
  })
  if (activeMatches.length > 0) {
    await addNotification(pool, userId, {
      kind: 'watch',
      title: '订阅代理发现新匹配',
      body: `${intent.text}：${activeMatches.slice(0, 3).map((match) => match.repo).join('、')}`,
      url: '/workbench/watch',
    })
  }
  return { href: '/workbench/watch', label: '查看关注匹配' }
}

async function enrichJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const config = loadConfig()
  const llm = config.llm ?? (await loadStoredLlmConfig(pool))
  const limit = Math.max(1, Math.min(50, Number(job.payload.enrichLimit) || 20))
  let token = decryptJobToken(job.payload.token) ?? config.githubToken ?? null
  if (!token) {
    const stored = await listUserGithubTokens(pool)
    token = stored[0]?.token ?? null
  }
  await progress(`富化 ${limit} 个待处理仓库…`)
  const enriched = await enrichPendingRepos(pool, {
    limit,
    topics: config.search.topics,
    token,
    llm,
  })
  const status = await loadDiscoveryStatus(pool)
  await addNotification(pool, userId, {
    kind: 'discover',
    title: '候选池富化完成',
    body: `本轮富化 ${enriched} 个仓库；当前 ${status.enrichedRepos} 个已富化，${status.pendingRepos} 个待处理。`,
    url: '/settings?pool=enriched',
  })
  return { href: '/settings?pool=enriched', label: `已富化 ${enriched} 个仓库` }
}

async function activityJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const token = requireToken(job)
  await progress('检查仓库的 star / fork / Issue / PR 动态…')
  const user = await findUserById(pool, userId)
  if (!user) throw new Error('用户不存在')
  const result = await syncRepoActivity(pool, userId, user.login, token)
  await progress('写入新动态通知…')
  const note = result.warnings.length > 0 ? `；${result.warnings.length} 个仓库读取失败` : ''
  return {
    href: '/inbox',
    label: `查看动态（新增 ${result.notifications} 条${note}）`,
  }
}

async function similarJob(pool: DbPool, userId: number, job: JobRecord, progress: Progress): Promise<JobResult> {
  const llm = await loadLlm(pool)
  const project = job.payload.project?.trim()
  if (!project) throw new Error('缺少项目参数')
  const projects = await listUserProjects(pool, userId)
  const targetProject = projects.find(
    (item) => item.repoFullName.toLowerCase() === project.toLowerCase(),
  )
  if (!targetProject) throw new Error('只能对比自己维护的项目')

  let token = decryptJobToken(job.payload.token)
  if (!token) {
    const stored = await listUserGithubTokens(pool)
    token = stored.find((entry) => entry.userId === userId)?.token ?? stored[0]?.token ?? null
  }

  await progress('读取目标项目和相似候选…')
  const context = await loadProjectContext(targetProject.repoFullName, token)
  const targetTopics = context.topics.length > 0 ? context.topics : targetProject.topics
  const targetMeta = {
    fullName: targetProject.repoFullName,
    topics: targetTopics,
    language: context.language ?? targetProject.language,
  }
  const targetInput = {
    repo: targetProject.repoFullName,
    description: context.description || targetProject.description || '',
    language: context.language ?? targetProject.language,
    topics: targetTopics,
    readme: context.readme,
    manifestName: context.manifestName,
    manifest: context.manifest,
  }
  await progress('提取竞品关键词…')
  const derivedKeywords = await deriveSimilarProjectKeywords(targetInput, llm)
  const searchKeywords = [...new Set([...targetTopics, ...derivedKeywords])].slice(0, 10)
  const targetText = [
    targetInput.repo,
    targetInput.description,
    targetInput.readme ?? '',
    targetTopics.join(' '),
    derivedKeywords.join(' '),
  ].join(' ')

  const combinedScore = (metadata: number, language: string | null, text: string): number => {
    const languageScore = targetMeta.language && language === targetMeta.language ? 1 : 0
    return Math.min(
      1,
      metadata * 0.3 + textSimilarity(targetText, text) * 0.4 + keywordCoverage(searchKeywords, text) * 0.2 + languageScore * 0.1,
    )
  }

  const repos = await findReposForMatching(pool, {
    topics: targetTopics,
    language: targetMeta.language,
    keywords: derivedKeywords,
    limit: 300,
  })
  const candidateMap = new Map<
    string,
    { repo: string; similarity: number; stars: number; description: string; language: string | null; topics: string[] }
  >()
  for (const candidate of repos) {
    const text = [candidate.fullName, candidate.description ?? '', candidate.topics.join(' ')].join(' ')
    const similarity = combinedScore(
      repoSimilarity(targetMeta, candidate),
      candidate.language,
      text,
    )
    candidateMap.set(candidate.fullName.toLowerCase(), {
      repo: candidate.fullName,
      similarity,
      stars: candidate.stars,
      description: candidate.description ?? '',
      language: candidate.language,
      topics: candidate.topics,
    })
  }

  if (token) {
    await progress('在 GitHub 搜索竞品…')
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
    const language = targetMeta.language ? ` language:${targetMeta.language}` : ''
    const queries = [
      ...targetTopics.slice(0, 3).map((topic) => `topic:${topic}`),
      ...(targetTopics.length === 0 ? derivedKeywords.slice(0, 4) : derivedKeywords.slice(0, 2)),
    ]
    for (const term of [...new Set(queries)].slice(0, 6)) {
      try {
        const found = await searchRepos(`${term}${language} stars:>=50 pushed:>=${since} archived:false fork:false`, {
          token,
          perPage: 10,
        })
        for (const repo of found) {
          if (repo.fullName.toLowerCase() === project.toLowerCase()) continue
          const text = [repo.fullName, repo.description ?? '', repo.topics.join(' ')].join(' ')
          const similarity = combinedScore(repoSimilarity(targetMeta, repo), repo.language, text)
          if (similarity <= 0.05) continue
          await upsertRepo(pool, repo)
          const key = repo.fullName.toLowerCase()
          if (!candidateMap.has(key)) {
            candidateMap.set(key, {
              repo: repo.fullName,
              similarity,
              stars: repo.stars,
              description: repo.description ?? '',
              language: repo.language,
              topics: repo.topics,
            })
          }
        }
      } catch (error) {
        if (!(error instanceof GitHubApiError && error.status === 401)) {
          console.error('[job:similar] GitHub 搜索失败：', error)
        }
      }
      await sleep(300)
    }
  }

  const selected = [...candidateMap.values()]
    .sort((left, right) => right.similarity - left.similarity || right.stars - left.stars)
    .slice(0, 5)
  if (selected.length === 0) {
    throw new Error('没有找到足够相似的候选项目；请先补充候选池或检查项目的 topics')
  }

  await progress('读取相似项目上下文…')
  const candidates = []
  for (const item of selected) {
    const candidateContext = await loadProjectContext(item.repo, token)
    candidates.push({
      repo: item.repo,
      description: candidateContext.description || item.description,
      language: candidateContext.language ?? item.language,
      topics: candidateContext.topics.length > 0 ? candidateContext.topics : item.topics,
      readme: candidateContext.readme,
      manifestName: candidateContext.manifestName,
      manifest: candidateContext.manifest,
      similarity: item.similarity,
      stars: item.stars,
    })
  }

  await progress('模型对比相似项目…')
  const report = await generateSimilarReport(targetInput, candidates, llm)
  const reportId = await saveSimilarReport(pool, userId, targetProject.repoFullName, {
    report,
    generatedAt: new Date().toISOString(),
    model: llm.model,
    providerId: llm.providerId ?? null,
    promptVersion: PROMPT_VERSIONS.similar,
    candidateRepos: candidates.map((candidate) => candidate.repo),
  })
  const href = `/workbench/maintain/similar?repo=${encodeURIComponent(targetProject.repoFullName)}&report=${reportId}`
  await addNotification(pool, userId, {
    kind: 'similar',
    title: '相似项目对比已生成',
    body: `${targetProject.repoFullName}：${report.candidates.map((candidate) => candidate.repo).join('、')}`,
    url: href,
  })
  return { href, label: '查看相似项目对比' }
}

export async function runJobHandler(pool: DbPool, job: JobRecord, userId: number): Promise<JobResult> {
  const progress: Progress = (message) => updateJobProgress(pool, job.id, message)
  switch (job.kind) {
    case 'integration':
      return integrationJob(pool, userId, job, progress)
    case 'maintainer':
      return maintainerJob(pool, userId, job, progress)
    case 'issue':
      return issueJob(pool, userId, job, progress)
    case 'discoverability':
      return discoverabilityJob(pool, userId, job, progress)
    case 'comparison':
      return comparisonJob(pool, userId, job, progress)
    case 'issue-plan':
      return issuePlanJob(pool, userId, job, progress)
    case 'watch':
      return watchJob(pool, userId, job, progress)
    case 'activity':
      return activityJob(pool, userId, job, progress)
    case 'integration-trial':
      return integrationTrialJob(pool, userId, job, progress)
    case 'swap-trial':
      return swapTrialJob(pool, userId, job, progress)
    case 'patch':
      return patchJob(pool, userId, job, progress)
    case 'upgrade':
      return upgradeJob(pool, userId, job, progress)
    case 'discover':
      return discoveryJob(pool, userId, job, progress)
    case 'enrich':
      return enrichJob(pool, userId, job, progress)
    case 'similar':
      return similarJob(pool, userId, job, progress)
    default:
      throw new Error(`未知任务类型：${job.kind}`)
  }
}
