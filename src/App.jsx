import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const PROJECTS_KEY = 'projectBrain.projects.v1'
const ACCOUNT_KEY = 'projectBrain.account.v1'
const THEME_KEY = 'projectBrain.theme.v1'
const SETUP_KEY = 'projectBrain.setupDone.v1'

const DEFAULT_RETENTION_DAYS = 30
const MAX_ACTIVE_NOTES = 40
const MAX_GRAPH_NODES = 12

function makeDefaultModules() {
  const now = new Date().toISOString()
  const rootId = crypto.randomUUID()
  const filesId = crypto.randomUUID()
  return {
    modules: [
      { id: rootId, name: 'Project', parentId: null, createdAt: now, updatedAt: now },
      { id: filesId, name: 'Files', parentId: rootId, createdAt: now, updatedAt: now }
    ],
    defaultModuleId: rootId,
    filesModuleId: filesId
  }
}

function ensureProjectModules(project) {
  if (!project) return project
  if (Array.isArray(project.modules) && project.modules.length > 0 && project.defaultModuleId) return project
  const seeded = makeDefaultModules()
  return {
    ...project,
    modules: seeded.modules,
    defaultModuleId: seeded.defaultModuleId,
    filesModuleId: seeded.filesModuleId,
    selectedModuleId: project.selectedModuleId || seeded.defaultModuleId
  }
}

function collectDescendantModuleIds(modules, rootId) {
  const byParent = new Map()
  for (const m of modules || []) {
    const parent = m.parentId || null
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(m.id)
  }
  const out = new Set()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()
    if (!id || out.has(id)) continue
    out.add(id)
    const kids = byParent.get(id) || []
    for (const kid of kids) stack.push(kid)
  }
  return out
}

function autoFileMemoryModuleId(project) {
  if (!project) return null
  const choice = project.selectedModuleId
  if (choice && choice !== 'all') return choice
  return project.filesModuleId || project.defaultModuleId || null
}

function inferModuleIdFromFilePath(project, filePath) {
  if (!project || !filePath) return null
  const pathLower = String(filePath).toLowerCase()
  const segments = pathLower.split(/[\\/]/).filter(Boolean)
  const hay = new Set(segments)
  // Also include tokens for loose matching (e.g. "player-movement" -> ["player","movement"]).
  for (const s of segments) {
    for (const t of s.split(/[^a-z0-9]+/).filter(Boolean)) hay.add(t)
  }

  let best = null
  let bestScore = 0
  for (const mod of project.modules || []) {
    const name = String(mod?.name || '').trim().toLowerCase()
    if (!name) continue
    if (name === 'files') continue
    const tokens = name.split(/[^a-z0-9]+/).filter(Boolean)
    if (tokens.length === 0) continue
    let score = 0
    for (const tok of tokens) {
      if (tok.length < 3) continue
      if (hay.has(tok)) score += 3
      else if (pathLower.includes(tok)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = mod
    }
  }
  return bestScore > 0 ? best?.id || null : null
}

function autoFileMemoryModuleIdForPath(project, filePath) {
  const inferred = inferModuleIdFromFilePath(project, filePath)
  return inferred || autoFileMemoryModuleId(project)
}

function findOrCreateModulePath(project, pathParts) {
  const parts = (pathParts || []).map((p) => String(p || '').trim()).filter(Boolean)
  if (!project) return { project, moduleId: null }
  if (parts.length === 0) return { project, moduleId: project.defaultModuleId || null }

  const modules = [...(project.modules || [])]
  const now = new Date().toISOString()
  let parentId = null
  let currentId = null

  for (const name of parts) {
    const existing = modules.find((m) => (m.parentId || null) === parentId && m.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      currentId = existing.id
      parentId = existing.id
      continue
    }
    const created = { id: crypto.randomUUID(), name, parentId, createdAt: now, updatedAt: now }
    modules.push(created)
    currentId = created.id
    parentId = created.id
  }

  return { project: { ...project, modules, updatedAt: now }, moduleId: currentId }
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((p) => ensureProjectModules(p))
  } catch {
    return []
  }
}

function saveProjects(projects) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
  } catch {
    // no-op
  }
}

function loadAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.name) return null
    return parsed
  } catch {
    return null
  }
}

function saveAccount(account) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  } catch {
    // no-op
  }
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark'
  } catch {
    return 'dark'
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // no-op
  }
}

function loadSetupDone() {
  try {
    return localStorage.getItem(SETUP_KEY) === '1'
  } catch {
    return false
  }
}

function saveSetupDone(done) {
  try {
    localStorage.setItem(SETUP_KEY, done ? '1' : '0')
  } catch {
    // no-op
  }
}

function newNote() {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: 'New memory',
    body: 'What do you want Project Brain to remember?\n\nAdd key details, decisions, and next steps.',
    tags: ['seed'],
    moduleId: null,
    createdAt: now,
    updatedAt: now
  }
}

function makeWelcomeProject() {
  const now = new Date().toISOString()
  const seeded = makeDefaultModules()
  return {
    id: crypto.randomUUID(),
    name: 'Codex Challenge',
    createdAt: now,
    updatedAt: now,
    modules: seeded.modules,
    defaultModuleId: seeded.defaultModuleId,
    filesModuleId: seeded.filesModuleId,
    selectedModuleId: seeded.defaultModuleId,
    notes: [
      {
        id: crypto.randomUUID(),
        title: 'Welcome to Project Brain',
        body: 'Capture context like a second brain.\n\n- Use tags like #launch or #research\n- Keep decisions and rationale in the same memory\n- Link ideas by repeating keywords\n\nStart by creating a memory for your Codex Creator Challenge project.',
        tags: ['welcome', 'challenge'],
        moduleId: seeded.defaultModuleId,
        createdAt: now,
        updatedAt: now
      }
    ],
    condensed: [],
    fileMap: [
      {
        id: crypto.randomUUID(),
        path: 'README.md',
        summary: 'Project overview and roadmap',
        updatedAt: now
      },
      {
        id: crypto.randomUUID(),
        path: 'src/App.jsx',
        summary: 'UI and memory workflows',
        updatedAt: now
      }
    ],
    fileRevisions: {
      'README.md': 1,
      'src/App.jsx': 1
    },
    projectRoot: '',
    scanCounter: 0,
    lastSyncAt: null,
    conflicts: [],
    changeRequests: [
      {
        id: crypto.randomUUID(),
        title: 'Add team collaboration flow',
        status: 'queued'
      }
    ],
    retention: {
      days: DEFAULT_RETENTION_DAYS,
      maxActiveNotes: MAX_ACTIVE_NOTES
    },
    collaborators: [],
    joinRequests: [],
    suggestions: [],
    ai: {
      provider: 'local',
      model: 'gpt-5-codex',
      localBackend: 'heuristic',
      localModel: 'qwen2.5-coder:7b',
      builtinModelFile: '',
      builtinModelUrl: ''
    },
    inviteCode: 'JOIN-6X9K',
    chat: [
      {
        id: crypto.randomUUID(),
        author: 'Project Brain',
        message: 'Welcome! Use invite codes to add collaborators. Every decision here stays in the project memory.',
        createdAt: now
      }
    ]
  }
}

function formatDate(iso) {
  const dt = new Date(iso)
  return dt.toLocaleString()
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function buildSummary(note) {
  const firstLine = note.body.split('\n').find((line) => line.trim().length > 0) || ''
  return `${note.title}: ${firstLine}`.slice(0, 180)
}

function buildProjectOverview(project) {
  if (!project) return ''
  const files = project.fileMap || []
  const topFiles = files.slice(0, 4).map((f) => `${f.path}: ${f.summary}`)
  const recentMemories = project.notes
    .slice(0, 3)
    .map((n) => `${n.title} — ${n.body.split('\n')[0]}`)
  const condensedCount = project.condensed?.length || 0

  return [
    `Project: ${project.name}`,
    `Active memories: ${project.notes.length} · Condensed memories: ${condensedCount}`,
    topFiles.length > 0 ? `Core files: ${topFiles.join(' | ')}` : 'Core files: (add file map entries)',
    recentMemories.length > 0
      ? `Recent context: ${recentMemories.join(' · ')}`
      : 'Recent context: (add memories to build understanding)',
    'Purpose: Maintain a living summary so collaborators and AI do not re-read the entire repo.'
  ].join('\n')
}

function parseTags(input) {
  // Accept: "tag1, tag2" or "tag1 tag2" or "#tag1,#tag2"
  return input
    .split(/[,;\n]+/)
    .flatMap((chunk) => chunk.trim().split(/\s+/))
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
}

function normalizeTags(tags) {
  const uniq = Array.from(new Set((tags || []).map((t) => String(t || '').trim()).filter(Boolean)))
  return uniq.slice(0, 24)
}

function notesEqual(a, b) {
  if (!a || !b) return false
  return (
    a.title === b.title &&
    a.body === b.body &&
    (a.tags || []).join('|') === (b.tags || []).join('|')
  )
}

function buildMergeSuggestion(localNote, incomingNote) {
  const title =
    localNote.title === incomingNote.title
      ? localNote.title
      : `${localNote.title} / ${incomingNote.title}`
  const localLines = localNote.body.split('\n')
  const incomingLines = incomingNote.body.split('\n')
  const combined = [...localLines, ...incomingLines.filter((line) => !localLines.includes(line))]
  const body = combined.join('\n')
  const tags = Array.from(new Set([...(localNote.tags || []), ...(incomingNote.tags || [])]))

  return {
    ...localNote,
    title,
    body,
    tags,
    updatedAt: new Date().toISOString()
  }
}

function filesEqual(a, b) {
  if (!a || !b) return false
  return a.path === b.path && a.summary === b.summary
}

function buildFileMergeSuggestion(localFile, incomingFile) {
  if (localFile.summary === incomingFile.summary) return localFile
  const combined = Array.from(
    new Set([localFile.summary, incomingFile.summary].filter(Boolean))
  ).join(' | ')
  return {
    ...localFile,
    summary: combined.slice(0, 200),
    updatedAt: new Date().toISOString()
  }
}

function mergeTextMedian(localText, incomingText) {
  if (localText === incomingText) return localText
  if (localText.includes(incomingText)) return localText
  if (incomingText.includes(localText)) return incomingText

  // Small, safe heuristic: preserve common prefix/suffix and concatenate differing middle parts.
  const a = localText.split('\n')
  const b = incomingText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1

  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1
    endB -= 1
  }

  const prefix = a.slice(0, start)
  const suffix = a.slice(endA + 1)
  const midA = a.slice(start, endA + 1)
  const midB = b.slice(start, endB + 1)

  const mergedMid = [
    ...midA,
    '',
    '/* --- incoming changes merged --- */',
    ...midB
  ]

  return [...prefix, ...mergedMid, ...suffix].join('\n')
}

function summarizeLineDelta(beforeText, afterText) {
  const before = (beforeText || '').split('\n')
  const after = (afterText || '').split('\n')
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  let added = 0
  let removed = 0
  for (const line of afterSet) if (!beforeSet.has(line)) added += 1
  for (const line of beforeSet) if (!afterSet.has(line)) removed += 1
  return { added, removed, beforeLines: before.length, afterLines: after.length }
}

function fileTagsFromPath(filePath) {
  const tags = ['file-edit']
  const base = (filePath || '').split(/[\\/]/).pop() || ''
  if (base) tags.push(base.toLowerCase())
  const ext = base.includes('.') ? base.split('.').pop() : ''
  if (ext) tags.push(ext.toLowerCase())
  return normalizeTags(tags)
}

function formatRelativeTime(iso) {
  try {
    const dt = new Date(iso)
    const diff = Date.now() - dt.getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

function applyStructuredEdit(beforeText, edit) {
  const action = edit?.action || (typeof edit?.content === 'string' ? 'overwrite' : 'patch')
  const before = String(beforeText ?? '')

  if (action === 'overwrite') return String(edit.content ?? '')
  if (action === 'append') {
    const addition = String(edit.content ?? '')
    if (!addition) return before
    return `${before}${before.endsWith('\n') || before.length === 0 ? '' : '\n'}${addition}`
  }

  if (action === 'patch') {
    const find = String(edit.find ?? '')
    const replace = String(edit.replace ?? '')
    const beforeCtx = String(edit.before_context ?? '')
    const afterCtx = String(edit.after_context ?? '')

    if (find && before.includes(find)) return before.replace(find, replace)

    // Context-based patch: replace the region between before_context and after_context.
    if (beforeCtx && afterCtx) {
      const start = before.indexOf(beforeCtx)
      if (start !== -1) {
        const from = start + beforeCtx.length
        const end = before.indexOf(afterCtx, from)
        if (end !== -1) {
          return `${before.slice(0, from)}${replace}${before.slice(end)}`
        }
      }
    }

    // If we cannot find a safe patch target, fall back to appending the replacement.
    if (replace) return `${before}${before.endsWith('\n') || before.length === 0 ? '' : '\n'}${replace}`
    return before
  }

  return before
}

function condenseOldContext(project) {
  const retentionDays = project.retention?.days ?? DEFAULT_RETENTION_DAYS
  const maxActiveNotes = project.retention?.maxActiveNotes ?? MAX_ACTIVE_NOTES
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  const sorted = [...project.notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  const keepFull = []
  const toCondense = []

  // Keep stubs forever (they're already condensed). Cap applies to full notes only.
  for (const note of sorted) {
    if (note?.isStub) continue
    const updated = new Date(note.updatedAt)
    if (keepFull.length < maxActiveNotes && updated >= cutoff) {
      keepFull.push(note)
    } else {
      toCondense.push(note)
    }
  }

  if (toCondense.length === 0) {
    return { project, changed: false, condensedCount: 0 }
  }

  const stamp = new Date().toISOString()
  const condenseIds = new Set(toCondense.map((n) => n.id))

  const condensedEntries = toCondense.map((note) => ({
    id: crypto.randomUUID(),
    sourceId: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags,
    moduleId: note.moduleId || null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    summary: buildSummary(note),
    condensedAt: stamp
  }))

  const stubbedNotes = (project.notes || []).map((note) => {
    if (!condenseIds.has(note.id)) return note
    const summary = buildSummary(note)
    const body = `Condensed automatically to keep the project fast.\n\nSummary:\n${summary}`
    return {
      ...note,
      isStub: true,
      condensedAt: stamp,
      body
    }
  })

  const updatedProject = {
    ...project,
    notes: stubbedNotes,
    condensed: [...condensedEntries, ...(project.condensed || [])],
    updatedAt: stamp
  }

  return { project: updatedProject, changed: true, condensedCount: condensedEntries.length }
}

function App() {
  const [projects, setProjects] = useState(() => {
    const existing = loadProjects()
    if (existing.length > 0) return existing
    return [makeWelcomeProject()]
  })

  const [selectedProjectId, setSelectedProjectId] = useState(() => projects[0]?.id ?? null)
  const [selectedNoteId, setSelectedNoteId] = useState(() => projects[0]?.notes?.[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [version, setVersion] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [inviteNameInput, setInviteNameInput] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupStep, setSetupStep] = useState(0)
  const [setupMode, setSetupMode] = useState('host')
  const [setupName, setSetupName] = useState('')
  const [setupHandle, setSetupHandle] = useState('')
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newModuleOpen, setNewModuleOpen] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')
  const [newModuleParentId, setNewModuleParentId] = useState('')
  const [archivedMemoryOpen, setArchivedMemoryOpen] = useState(false)
  const [archivedMemory, setArchivedMemory] = useState(null)
  const [account, setAccount] = useState(() => loadAccount())
  const [theme, setTheme] = useState(() => loadTheme())
  const [collabStatus, setCollabStatus] = useState('offline')
  const [serverUrl, setServerUrl] = useState('wss://your-signal-server')
  const [collabRole, setCollabRole] = useState('idle')
  const [peers, setPeers] = useState([])
  const [localRole, setLocalRole] = useState('viewer')
  const [directOfferOut, setDirectOfferOut] = useState('')
  const [directOfferIn, setDirectOfferIn] = useState('')
  const [directAnswerOut, setDirectAnswerOut] = useState('')
  const [directAnswerIn, setDirectAnswerIn] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileStatus, setFileStatus] = useState('')
  const [selectedFileRev, setSelectedFileRev] = useState(0)
  const [fileFilter, setFileFilter] = useState('')
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [openAIKeyInput, setOpenAIKeyInput] = useState('')
  const [openAIKeyPresent, setOpenAIKeyPresent] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiConsoleReply, setAiConsoleReply] = useState('')
  const [aiConsoleScope, setAiConsoleScope] = useState('selected')
  const [aiConsoleBusy, setAiConsoleBusy] = useState(false)
  const [aiConsoleExpanded, setAiConsoleExpanded] = useState(false)
  const [aiOnlyMode, setAiOnlyMode] = useState(false)
  const [aiOnlyPrompt, setAiOnlyPrompt] = useState('')
  const [aiOnlyBusy, setAiOnlyBusy] = useState(false)
  const [builtinModels, setBuiltinModels] = useState([])
  const [fileEditorExpanded, setFileEditorExpanded] = useState(false)
  const [workbenchTab, setWorkbenchTab] = useState('files')
  const [workbenchCollapsed, setWorkbenchCollapsed] = useState(false)
  const socketRef = useRef(null)
  const peerConnectionsRef = useRef(new Map())
  const dataChannelsRef = useRef(new Map())
  const isApplyingRemoteRef = useRef(false)
  const pendingFileRequestsRef = useRef(new Map())
  const fileRequestPromisesRef = useRef(new Map())
  const directPendingRef = useRef(null)

  const activeProjectRaw = projects.find((p) => p.id === selectedProjectId) || projects[0]
  const activeProject = ensureProjectModules(activeProjectRaw)
  const notes = activeProject?.notes || []
  const activeProjectRef = useRef(activeProject)

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  useEffect(() => {
    if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id)
  }, [projects, selectedProjectId])

  useEffect(() => {
    if (window.projectBrain?.getVersion) {
      window.projectBrain.getVersion().then((v) => setVersion(v))
    }
  }, [])

  useEffect(() => {
    if (!window.projectBrain?.loadData) return
    window.projectBrain.loadData().then((content) => {
      if (!content) return
      try {
        const parsed = JSON.parse(content)
        if (parsed.account) {
          setAccount(parsed.account)
          saveAccount(parsed.account)
        }
        if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          setProjects(parsed.projects)
          setSelectedProjectId(parsed.projects[0]?.id ?? null)
          setSelectedNoteId(parsed.projects[0]?.notes?.[0]?.id ?? null)
        }
        if (parsed.theme) {
          setTheme(parsed.theme)
          saveTheme(parsed.theme)
        }
      } catch {
        // no-op
      }
    })
  }, [])

  useEffect(() => {
    if (!window.projectBrain?.secretsHas) return
    window.projectBrain.secretsHas({ key: 'openai_api_key' }).then((has) => {
      setOpenAIKeyPresent(Boolean(has))
    })
  }, [])

  useEffect(() => {
    if (!window.projectBrain?.builtinListModels) return
    window.projectBrain.builtinListModels().then((res) => {
      if (res?.ok) setBuiltinModels(res.models || [])
    })
  }, [])

  useEffect(() => {
    document.body.dataset.theme = theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    // First-run wizard for clarity on a new machine.
    if (loadSetupDone()) return
    setSetupOpen(true)
    setSetupStep(0)
    setSetupMode('host')
    setSetupName('')
    setSetupHandle('')
  }, [])

  useEffect(() => {
    if (!activeProject?.ai?.provider) return
    if (activeProject.ai.provider === 'ollama') {
      window.projectBrain?.ollamaEnsureRunning?.().then((res) => {
        if (!res?.ok && res?.detail) setAiStatus(res.detail)
      })
    }
    if (activeProject.ai.provider === 'builtin') {
      window.projectBrain?.builtinEnsureRuntime?.({ download: false }).then((res) => {
        if (!res?.ok && res?.detail) setAiStatus(res.detail)
      })
    }
  }, [activeProject?.ai?.provider])

  useEffect(() => {
    if (!window.projectBrain?.saveData) return
    window.projectBrain.saveData({ account, projects, theme })
  }, [account, projects, theme])

  useEffect(() => {
    if (collabRole !== 'host') return
    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false
      return
    }
    const project = activeProjectRef.current
    if (!project) return
    if (dataChannelsRef.current.size === 0) return
    const syncedProject = { ...project, lastSyncAt: new Date().toISOString() }
    isApplyingRemoteRef.current = true
    updateProject(syncedProject)
    broadcastProject(syncedProject)
  }, [projects, collabRole])

  useEffect(() => {
    if (collabRole !== 'client') return
    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false
      return
    }
    if (localRole === 'viewer') return
    const project = activeProjectRef.current
    if (!project) return
    if (dataChannelsRef.current.size === 0) return
    const syncedProject = { ...project, lastSyncAt: new Date().toISOString() }
    isApplyingRemoteRef.current = true
    updateProject(syncedProject)
    if (localRole === 'suggester') {
      broadcastSuggestion(syncedProject)
    } else {
      broadcastProject(syncedProject)
    }
  }, [projects, collabRole, localRole])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  useEffect(() => {
    if (!activeProjectRaw) return
    if (activeProjectRaw.modules && activeProjectRaw.defaultModuleId) return
    // One-time migration to add module tree to older saved projects.
    updateProject(activeProject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectRaw?.id])

  useEffect(() => {
    if (activeProject && !selectedNoteId && notes[0]) setSelectedNoteId(notes[0].id)
  }, [activeProject, notes, selectedNoteId])

  useEffect(() => {
    if (!activeProject) return
    const res = condenseOldContext(activeProject)
    if (!res.changed) return
    const stamp = new Date().toISOString()
    const msg = {
      id: crypto.randomUUID(),
      author: 'Project Brain',
      message: `Condensed ${res.condensedCount} memory/memories into lightweight stubs (web preserved).`,
      createdAt: stamp
    }
    const withMsg = {
      ...res.project,
      chat: [...(res.project.chat || []), msg],
      updatedAt: stamp
    }
    setProjects((prev) => prev.map((p) => (p.id === withMsg.id ? withMsg : p)))
  }, [activeProject])

  useEffect(() => {
    if (!activeProject?.projectRoot) return
    if ((activeProject.scanCounter || 0) >= 3) {
      handleScanProject(true)
    }
  }, [activeProject?.projectRoot, activeProject?.scanCounter])

  useEffect(() => {
    // Zero-friction: as soon as the host/solo sets a project root, auto-scan once so collaborators can browse files.
    if (!activeProject?.projectRoot) return
    if (!isHostLike) return
    if (isScanning) return
    if ((activeProject.fileMap || []).length > 0) return
    ;(async () => {
      try {
        await handleScanProject()
      } catch {
        // ignore
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.projectRoot, isHostLike])

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase()
    const tag = tagFilter.trim().toLowerCase()
    const moduleChoice =
      activeProject?.selectedModuleId && activeProject.selectedModuleId !== 'all'
        ? activeProject.selectedModuleId
        : null
    const moduleSet = moduleChoice
      ? collectDescendantModuleIds(activeProject?.modules || [], moduleChoice)
      : null
    return notes.filter((note) => {
      const noteModule = note.moduleId || activeProject?.defaultModuleId || null
      const matchesModule = !moduleSet || (noteModule && moduleSet.has(noteModule))
      const matchesQuery =
        !q ||
        note.title.toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q) ||
        note.tags.some((t) => t.toLowerCase().includes(q))

      const matchesTag = !tag || note.tags.some((t) => t.toLowerCase() === tag)
      return matchesModule && matchesQuery && matchesTag
    })
  }, [notes, query, tagFilter, activeProject?.selectedModuleId, activeProject?.defaultModuleId, activeProject?.modules])

  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null

  function findArchivedEntryForNote(note) {
    if (!activeProject || !note) return null
    const sourceId = note.condensedSourceId || note.id
    return (activeProject.condensed || []).find((c) => c.sourceId === sourceId) || null
  }

  function restoreStubNote(noteId) {
    if (!activeProject) return
    const note = (activeProject.notes || []).find((n) => n.id === noteId)
    if (!note?.isStub) return
    const archived = findArchivedEntryForNote(note)
    if (!archived) {
      setAiStatus('Archived copy not found.')
      setTimeout(() => setAiStatus(''), 1800)
      return
    }
    const restored = {
      ...note,
      title: archived.title || note.title,
      body: archived.body || note.body,
      tags: normalizeTags(archived.tags || note.tags || []),
      moduleId: archived.moduleId || note.moduleId || activeProject.defaultModuleId,
      isStub: false,
      condensedAt: null,
      updatedAt: new Date().toISOString()
    }
    const updated = {
      ...activeProject,
      notes: (activeProject.notes || []).map((n) => (n.id === noteId ? restored : n)),
      condensed: (activeProject.condensed || []).filter((c) => c.id !== archived.id),
      updatedAt: new Date().toISOString()
    }
    updateProject(updated)
    setAiStatus('Restored full memory.')
    setTimeout(() => setAiStatus(''), 1600)
  }

  function updateProject(updatedProject) {
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)))
  }

  function notifyConflict(conflict) {
    const project = activeProjectRef.current
    if (!project) return
    const label = conflict.local?.title || conflict.filePath || 'item'
    const message = {
      type: 'chat',
      author: 'Project Brain',
      message: `Conflict detected in "${label}". Review and resolve.`,
      createdAt: new Date().toISOString()
    }
    appendChatMessage(project.id, {
      id: crypto.randomUUID(),
      author: message.author,
      message: message.message,
      createdAt: message.createdAt
    })
    if (collabRole === 'host') {
      broadcastChat(message)
    } else if (dataChannelsRef.current.size > 0) {
      broadcastChat(message)
    }
  }

  function applyIncomingProject(incomingProject, sourcePeerId) {
    const localProject = activeProjectRef.current
    if (!localProject || localProject.id !== incomingProject.id) {
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === incomingProject.id)
        if (exists) {
          return prev.map((p) => (p.id === incomingProject.id ? incomingProject : p))
        }
        return [incomingProject, ...prev]
      })
      setSelectedProjectId(incomingProject.id)
      setSelectedNoteId(incomingProject.notes?.[0]?.id ?? null)
      return
    }

    const lastSync = localProject.lastSyncAt ? new Date(localProject.lastSyncAt) : new Date(0)
    const incomingNotes = incomingProject.notes || []
    const localNotes = localProject.notes || []
    const mergedNotes = []
    const conflicts = [...(localProject.conflicts || [])]
    const localById = new Map(localNotes.map((note) => [note.id, note]))

    for (const incoming of incomingNotes) {
      const local = localById.get(incoming.id)
      if (!local) {
        mergedNotes.push(incoming)
        continue
      }

      if (notesEqual(local, incoming)) {
        mergedNotes.push(local)
        continue
      }

      const localUpdated = new Date(local.updatedAt)
      const incomingUpdated = new Date(incoming.updatedAt)
      const isConflict = localUpdated > lastSync && incomingUpdated > lastSync

      if (isConflict) {
        const conflict = {
          id: crypto.randomUUID(),
          kind: 'note',
          noteId: local.id,
          local,
          incoming,
          suggested: buildMergeSuggestion(local, incoming),
          createdAt: new Date().toISOString()
        }
        conflicts.unshift(conflict)
        mergedNotes.push(local)
        notifyConflict(conflict)
      } else {
        mergedNotes.push(incomingUpdated > localUpdated ? incoming : local)
      }
    }

    for (const local of localNotes) {
      if (!incomingNotes.find((note) => note.id === local.id)) {
        mergedNotes.push(local)
      }
    }

    const incomingFiles = (incomingProject.fileMap || []).map((file) => ({
      ...file,
      updatedAt: file.updatedAt || incomingProject.updatedAt || new Date().toISOString()
    }))
    const localFiles = (localProject.fileMap || []).map((file) => ({
      ...file,
      updatedAt: file.updatedAt || localProject.updatedAt || new Date().toISOString()
    }))
    const mergedFiles = []
    const localFilesByPath = new Map(localFiles.map((file) => [file.path, file]))

    for (const incoming of incomingFiles) {
      const local = localFilesByPath.get(incoming.path)
      if (!local) {
        mergedFiles.push(incoming)
        continue
      }

      if (filesEqual(local, incoming)) {
        mergedFiles.push(local)
        continue
      }

      const localUpdated = new Date(local.updatedAt)
      const incomingUpdated = new Date(incoming.updatedAt)
      const isConflict = localUpdated > lastSync && incomingUpdated > lastSync

      if (isConflict) {
        const conflict = {
          id: crypto.randomUUID(),
          kind: 'file',
          filePath: local.path,
          local,
          incoming,
          suggested: buildFileMergeSuggestion(local, incoming),
          createdAt: new Date().toISOString()
        }
        conflicts.unshift(conflict)
        mergedFiles.push(local)
        notifyConflict({
          local: { title: local.path }
        })
      } else {
        mergedFiles.push(incomingUpdated > localUpdated ? incoming : local)
      }
    }

    for (const local of localFiles) {
      if (!incomingFiles.find((file) => file.path === local.path)) {
        mergedFiles.push(local)
      }
    }

    const mergedProject = {
      ...localProject,
      ...incomingProject,
      notes: mergedNotes,
      fileMap: mergedFiles,
      conflicts,
      lastSyncAt: new Date().toISOString()
    }

    setProjects((prev) => prev.map((p) => (p.id === mergedProject.id ? mergedProject : p)))
    if (collabRole === 'host') {
      broadcastProject(mergedProject, sourcePeerId)
    }
  }

  function approveSuggestion(suggestionId) {
    if (!activeProject) return
    if (!canManage) return
    const suggestion = (activeProject.suggestions || []).find((s) => s.id === suggestionId)
    if (!suggestion) return
    if (suggestion.kind === 'project') {
      applyIncomingProject(suggestion.project, suggestion.fromPeerId)
    }
    if (suggestion.kind === 'file') {
      applyFileUpdate(
        suggestion.filePath,
        suggestion.content,
        suggestion.fromName,
        suggestion.fromPeerId,
        suggestion.baseRev
      )
    }
    updateProject({
      ...activeProject,
      suggestions: (activeProject.suggestions || []).filter((s) => s.id !== suggestionId)
    })
  }

  function rejectSuggestion(suggestionId) {
    if (!activeProject) return
    if (!canManage) return
    updateProject({
      ...activeProject,
      suggestions: (activeProject.suggestions || []).filter((s) => s.id !== suggestionId)
    })
  }

  function removeCollaborator(peerId) {
    if (!activeProject) return
    if (!canManage) return
    const updated = {
      ...activeProject,
      collaborators: (activeProject.collaborators || []).filter((c) => c.peerId !== peerId)
    }
    updateProject(updated)
    teardownPeer(peerId)
  }

  function handleCreateProject() {
    setNewProjectName('')
    setNewProjectOpen(true)
  }

  function commitCreateProject(nameInput) {
    const name = (nameInput || '').trim()
    if (!name) return
    const now = new Date().toISOString()
    const seeded = makeDefaultModules()
    const project = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      modules: seeded.modules,
      defaultModuleId: seeded.defaultModuleId,
      filesModuleId: seeded.filesModuleId,
      selectedModuleId: seeded.defaultModuleId,
      notes: [newNote()],
      condensed: [],
      fileMap: [],
      fileRevisions: {},
      projectRoot: '',
      scanCounter: 0,
      lastSyncAt: null,
      conflicts: [],
      changeRequests: [],
      retention: {
        days: DEFAULT_RETENTION_DAYS,
        maxActiveNotes: MAX_ACTIVE_NOTES
      },
      collaborators: [],
      joinRequests: [],
      suggestions: [],
      ai: {
        provider: 'local',
        model: 'gpt-5-codex',
        localBackend: 'heuristic',
        localModel: 'qwen2.5-coder:7b',
        builtinModelFile: '',
        builtinModelUrl: ''
      },
      inviteCode: `JOIN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      chat: []
    }
    project.notes = project.notes.map((n) => ({ ...n, moduleId: project.selectedModuleId }))
    setProjects((prev) => [project, ...prev])
    setSelectedProjectId(project.id)
    setSelectedNoteId(project.notes[0].id)
    setNewProjectOpen(false)
  }

  function handleCreateNote() {
    if (!activeProject) return
    const created = newNote()
    const moduleId =
      activeProject.selectedModuleId && activeProject.selectedModuleId !== 'all'
        ? activeProject.selectedModuleId
        : activeProject.defaultModuleId
    created.moduleId = moduleId
    const updatedProject = {
      ...activeProject,
      notes: [created, ...notes],
      scanCounter: (activeProject.scanCounter || 0) + 1,
      lastSyncAt: activeProject.lastSyncAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    updateProject(updatedProject)
    setSelectedNoteId(created.id)
  }

  function handleDeleteNote(id) {
    if (!activeProject) return
    const remaining = notes.filter((n) => n.id !== id)
    const updatedProject = {
      ...activeProject,
      notes: remaining,
      scanCounter: (activeProject.scanCounter || 0) + 1,
      lastSyncAt: activeProject.lastSyncAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    updateProject(updatedProject)
    if (selectedNoteId === id) {
      setSelectedNoteId(remaining[0]?.id ?? null)
    }
  }

  function updateSelectedNote(patch) {
    if (!activeProject || !selectedNote) return
    const normalizedPatch = { ...patch }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'tags')) {
      normalizedPatch.tags = normalizeTags(normalizedPatch.tags)
    }
    const updatedNotes = notes.map((note) =>
      note.id === selectedNote.id
        ? { ...note, ...normalizedPatch, updatedAt: new Date().toISOString() }
        : note
    )
    updateProject({
      ...activeProject,
      notes: updatedNotes,
      scanCounter: (activeProject.scanCounter || 0) + 1,
      lastSyncAt: activeProject.lastSyncAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }

  function handleCondense() {
    if (!activeProject) return
    const res = condenseOldContext(activeProject)
    if (!res.changed) {
      setAiStatus('Nothing eligible to condense yet (try lowering retention settings or add more memories).')
      setTimeout(() => setAiStatus(''), 2200)
    } else {
      const stamp = new Date().toISOString()
      updateProject({
        ...res.project,
        chat: [
          ...(res.project.chat || []),
          {
            id: crypto.randomUUID(),
            author: 'Project Brain',
            message: `Condensed ${res.condensedCount} memory/memories into lightweight stubs (web preserved).`,
            createdAt: stamp
          }
        ],
        updatedAt: stamp
      })
      setAiStatus('Condensed older context into lightweight stubs.')
      setTimeout(() => setAiStatus(''), 1800)
    }
  }

  async function handleSelectProjectRoot() {
    if (!activeProject || !window.projectBrain?.selectProjectRoot) return
    const selected = await window.projectBrain.selectProjectRoot()
    if (!selected) return
    updateProject({ ...activeProject, projectRoot: selected })
  }

  async function handleScanProject() {
    if (!activeProject || !window.projectBrain?.scanProject || !activeProject.projectRoot) return
    if (isScanning) return
    setIsScanning(true)
    try {
      const scanned = await window.projectBrain.scanProject(activeProject.projectRoot)
      const stamp = new Date().toISOString()
      const normalized = scanned.map((file) => ({
        ...file,
        updatedAt: file.updatedAt || stamp
      }))
      const fileRevisions = { ...(activeProject.fileRevisions || {}) }
      for (const file of normalized) {
        if (!fileRevisions[file.path]) fileRevisions[file.path] = 1
      }
      updateProject({
        ...activeProject,
        fileMap: normalized,
        fileRevisions,
        scanCounter: 0,
        updatedAt: new Date().toISOString()
      })
    } finally {
      setIsScanning(false)
    }
  }

  async function handleLoadFile(path) {
    if (!path) return
    setSelectedFilePath(path)
    setFileContent('')
    setSelectedFileRev((activeProject?.fileRevisions || {})[path] || 1)

    if (isHostLike) {
      if (!activeProject?.projectRoot || !window.projectBrain?.readFile) return
      const content = await window.projectBrain.readFile({
        rootPath: activeProject.projectRoot,
        relativePath: path
      })
      if (content === null) {
        setFileStatus('Unable to read file')
        return
      }
      setFileContent(content)
      setFileStatus('')
      return
    }

    if (dataChannelsRef.current.size === 0) {
      setFileStatus('Not connected to host')
      return
    }

    const requestId = crypto.randomUUID()
    pendingFileRequestsRef.current.set(requestId, path)
    setFileStatus('Requesting file from host…')
    sendToHost({ type: 'file_request', path, requestId })
  }

  function requestFileFromHost(path) {
    if (!path) return Promise.resolve({ content: '', rev: 1 })
    if (dataChannelsRef.current.size === 0) return Promise.resolve({ content: '', rev: 1 })
    const requestId = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        fileRequestPromisesRef.current.delete(requestId)
        resolve({ content: '', rev: 1 })
      }, 6000)
      fileRequestPromisesRef.current.set(requestId, (payload) => {
        clearTimeout(timer)
        fileRequestPromisesRef.current.delete(requestId)
        resolve({ content: payload.content || '', rev: payload.rev || 1 })
      })
      pendingFileRequestsRef.current.set(requestId, path)
      sendToHost({ type: 'file_request', path, requestId })
    })
  }

  async function handleSaveFile() {
    if (!selectedFilePath) return
    if (!canEdit) return
    if (isHostLike) {
      if (!activeProject?.projectRoot) return
      const before = await window.projectBrain?.readFile?.({
        rootPath: activeProject.projectRoot,
        relativePath: selectedFilePath
      })
      const ok = await window.projectBrain?.writeFile({
        rootPath: activeProject.projectRoot,
        relativePath: selectedFilePath,
        content: fileContent
      })
      if (!ok) {
        setFileStatus('Save failed')
        return
      }
      const currentRev = (activeProject.fileRevisions || {})[selectedFilePath] || 1
      const nextRev = currentRev + 1
      const stamp = new Date().toISOString()
      const fileRevisions = { ...(activeProject.fileRevisions || {}), [selectedFilePath]: nextRev }
      const existingEntry = (activeProject.fileMap || []).find((f) => f.path === selectedFilePath)
      const fileMap = existingEntry
        ? (activeProject.fileMap || []).map((f) =>
            f.path === selectedFilePath ? { ...f, updatedAt: stamp } : f
          )
        : [
            {
              id: crypto.randomUUID(),
              path: selectedFilePath,
              summary: 'New file',
              updatedAt: stamp
            },
            ...(activeProject.fileMap || [])
          ]
      updateProject({
        ...activeProject,
        fileRevisions,
        fileMap,
        updatedAt: stamp
      })

      const delta = summarizeLineDelta(before ?? '', fileContent ?? '')
      appendAutoMemory(activeProject.id, {
        id: crypto.randomUUID(),
        title: `File edit: ${selectedFilePath}`,
        body: `Edited by ${account?.name || 'Host'}.\nRev ${currentRev} → ${nextRev}.\nLines: ${delta.beforeLines} → ${delta.afterLines} (added ~${delta.added}, removed ~${delta.removed}).`,
        tags: fileTagsFromPath(selectedFilePath),
        moduleId: autoFileMemoryModuleIdForPath(activeProject, selectedFilePath),
        createdAt: stamp,
        updatedAt: stamp
      })

      broadcastChat({ type: 'file_applied', path: selectedFilePath, rev: nextRev, author: account?.name || 'Host' })
      // Stream updated content to connected peers so they can view the full file without re-requesting.
      if (collabRole === 'host' && (fileContent || '').length <= 200_000) {
        for (const [, channel] of dataChannelsRef.current.entries()) {
          if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'file_content_update', path: selectedFilePath, content: fileContent, rev: nextRev }))
          }
        }
      }
      setSelectedFileRev(nextRev)
      setFileStatus('Saved to host')
    } else if (localRole === 'editor' || localRole === 'admin') {
      sendToHost({
        type: 'file_update',
        path: selectedFilePath,
        content: fileContent,
        baseRev: selectedFileRev,
        author: account?.name || 'Editor'
      })
      setFileStatus('Sent to host for apply')
    } else if (localRole === 'suggester') {
      sendToHost({
        type: 'file_suggestion',
        path: selectedFilePath,
        content: fileContent,
        baseRev: selectedFileRev,
        author: account?.name || 'Suggester'
      })
      setFileStatus('Sent as suggestion')
    }
  }

  function openNewFileModal() {
    setNewFilePath('')
    setNewFileContent('')
    setNewFileOpen(true)
  }

  async function commitCreateFile() {
    if (!activeProject) return
    if (!canEdit) return
    const relPath = (newFilePath || '').trim().replace(/^[/\\]+/, '')
    if (!relPath) return

    // Host writes directly; clients send a file_update which the host will apply (and add to file map).
    if (isHostLike) {
      if (!activeProject.projectRoot) {
        setAiStatus('Set the project root first.')
        setTimeout(() => setAiStatus(''), 2000)
        return
      }
      const before = await window.projectBrain?.readFile?.({
        rootPath: activeProject.projectRoot,
        relativePath: relPath
      })
      const ok = await window.projectBrain?.writeFile?.({
        rootPath: activeProject.projectRoot,
        relativePath: relPath,
        content: newFileContent ?? ''
      })
      if (!ok) {
        setAiStatus('Unable to create file (host write failed).')
        setTimeout(() => setAiStatus(''), 2000)
        return
      }
      const currentRev = (activeProject.fileRevisions || {})[relPath] || 1
      const nextRev = currentRev + 1
      const stamp = new Date().toISOString()
      const fileMapHas = (activeProject.fileMap || []).some((f) => f.path === relPath)
      const fileMap = fileMapHas
        ? activeProject.fileMap
        : [
            {
              id: crypto.randomUUID(),
              path: relPath,
              summary: 'New file',
              updatedAt: stamp
            },
            ...(activeProject.fileMap || [])
          ]
      updateProject({
        ...activeProject,
        fileMap,
        fileRevisions: { ...(activeProject.fileRevisions || {}), [relPath]: nextRev },
        updatedAt: stamp
      })
      const delta = summarizeLineDelta(before ?? '', newFileContent ?? '')
      appendAutoMemory(activeProject.id, {
        id: crypto.randomUUID(),
        title: `File created: ${relPath}`,
        body: `Created by ${account?.name || 'Host'}.\nRev ${currentRev} → ${nextRev}.\nLines: ${delta.beforeLines} → ${delta.afterLines} (added ~${delta.added}, removed ~${delta.removed}).`,
        tags: normalizeTags([...fileTagsFromPath(relPath), 'file-create']),
        moduleId: autoFileMemoryModuleIdForPath(activeProject, relPath),
        createdAt: stamp,
        updatedAt: stamp
      })
      setNewFileOpen(false)
      setSelectedFilePath(relPath)
      setSelectedFileRev(nextRev)
      setFileContent(newFileContent ?? '')
      setFileStatus('Created on host')
      return
    }

    if (dataChannelsRef.current.size === 0) {
      setAiStatus('Not connected to a host yet.')
      setTimeout(() => setAiStatus(''), 1800)
      return
    }

    sendToHost({
      type: 'file_update',
      path: relPath,
      content: newFileContent ?? '',
      baseRev: 0,
      author: account?.name || 'Editor'
    })
    setNewFileOpen(false)
    setAiStatus('Sent file create to host.')
    setTimeout(() => setAiStatus(''), 1600)
  }

  function appendChatMessage(projectId, message) {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, chat: [...(project.chat || []), message] }
          : project
      )
    )
  }

  function appendAutoMemory(projectId, note) {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              notes: [{ ...note }, ...(project.notes || [])],
              scanCounter: (project.scanCounter || 0) + 1,
              updatedAt: new Date().toISOString()
            }
          : project
      )
    )
  }

  function addPeer(id, name) {
    setPeers((prev) => {
      if (prev.some((peer) => peer.id === id)) return prev
      return [...prev, { id, name }]
    })
  }

  function removePeer(id) {
    setPeers((prev) => prev.filter((peer) => peer.id !== id))
  }

  function updateCollabStatus() {
    const openChannels = [...dataChannelsRef.current.values()].filter(
      (channel) => channel.readyState === 'open'
    ).length
    if (openChannels > 0) {
      setCollabStatus('secure')
      return
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      setCollabStatus('waiting')
      return
    }
    setCollabStatus('offline')
  }

  function teardownPeer(peerId) {
    if (peerId) {
      const channel = dataChannelsRef.current.get(peerId)
      if (channel) channel.close()
      dataChannelsRef.current.delete(peerId)
      const peer = peerConnectionsRef.current.get(peerId)
      if (peer) peer.close()
      peerConnectionsRef.current.delete(peerId)
      removePeer(peerId)
    } else {
      for (const [id, channel] of dataChannelsRef.current.entries()) {
        channel.close()
        dataChannelsRef.current.delete(id)
      }
      for (const [id, peer] of peerConnectionsRef.current.entries()) {
        peer.close()
        peerConnectionsRef.current.delete(id)
      }
      setPeers([])
    }
    updateCollabStatus()
  }

  function broadcastChat(payload, excludeId) {
    for (const [id, channel] of dataChannelsRef.current.entries()) {
      if (excludeId && id === excludeId) continue
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(payload))
      }
    }
  }

  function sendToPeer(peerId, payload) {
    const channel = dataChannelsRef.current.get(peerId)
    if (!channel || channel.readyState !== 'open') return
    channel.send(JSON.stringify(payload))
  }

  function sendToHost(payload) {
    // Clients only connect to the host; choose the first open channel.
    for (const channel of dataChannelsRef.current.values()) {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(payload))
        return true
      }
    }
    return false
  }

  async function mergeFileContentsWithBot({ filePath, localContent, incomingContent }) {
    const project = activeProjectRef.current
    const provider = project?.ai?.provider || 'local'
    if (provider === 'builtin') {
      const modelFile = project?.ai?.builtinModelFile
      if (!modelFile) return mergeTextMedian(localContent, incomingContent)
      try {
        setAiStatus('Starting built-in local model…')
        const runtime = await window.projectBrain?.builtinEnsureRuntime?.({ download: false })
        if (!runtime?.ok) {
          setAiStatus('Install the built-in runtime first.')
          return mergeTextMedian(localContent, incomingContent)
        }
        await window.projectBrain?.builtinStartServer?.({ modelFile, port: 8081 })
        setAiStatus('')
        const response = await fetch('http://127.0.0.1:8081/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'local',
            messages: [
              {
                role: 'system',
                content:
                  'You are a senior engineer. Merge two competing edits of the same file into a single best version. Preserve intent from both. Output ONLY the merged file content. No markdown.'
              },
              {
                role: 'user',
                content: `PATH: ${filePath}\n\nLOCAL:\n${localContent}\n\nINCOMING:\n${incomingContent}\n`
              }
            ],
            temperature: 0.2
          })
        })
        if (response.ok) {
          const json = await response.json()
          const text = json?.choices?.[0]?.message?.content
          if (typeof text === 'string' && text.trim().length > 0) return text
        } else {
          // Fallback for runtimes that only support /completion.
          const fallback = await fetch('http://127.0.0.1:8081/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt:
                `Merge two competing edits of the same file into a single best version. Preserve intent from both. Output ONLY the merged file content.\n\nPATH: ${filePath}\n\nLOCAL:\n${localContent}\n\nINCOMING:\n${incomingContent}\n`,
              temperature: 0.2
            })
          })
          if (fallback.ok) {
            const json = await fallback.json()
            const text = json?.content || json?.completion || json?.response
            if (typeof text === 'string' && text.trim().length > 0) return text
          }
        }
      } catch {
        // fall back
      } finally {
        setTimeout(() => setAiStatus(''), 1200)
      }
    }
    if (provider === 'ollama') {
      const model = project?.ai?.localModel || 'qwen2.5-coder:7b'
      const res = await window.projectBrain?.ollamaEnsureRunning?.()
      if (res?.ok) {
        try {
          const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              stream: false,
              prompt: `Merge two competing edits of the same file into a single best version. Preserve intent from both. Output ONLY the merged file content.\n\nPATH: ${filePath}\n\nLOCAL:\n${localContent}\n\nINCOMING:\n${incomingContent}\n`
            })
          })
          if (response.ok) {
            const json = await response.json()
            if (json?.response) return json.response
          }
        } catch {
          // fall back
        }
      }
    }
    if (provider === 'openai') {
      const merged = await callOpenAIText({
        model: project?.ai?.model || 'gpt-5-codex',
        instructions:
          'You are a senior engineer. Merge two competing edits of the same file into a single best version. Preserve intent from both. Output ONLY the merged file content. No markdown.',
        input: JSON.stringify({
          path: filePath,
          local: localContent,
          incoming: incomingContent
        })
      })
      if (merged) return merged
    }
    return mergeTextMedian(localContent, incomingContent)
  }

  async function applyFileUpdate(path, content, author, sourcePeerId, baseRev) {
    const project = activeProjectRef.current
    if (!project?.projectRoot || !window.projectBrain?.writeFile) return

    if (sourcePeerId) {
      const role =
        (project.collaborators || []).find((c) => c.peerId === sourcePeerId)?.role || 'viewer'
      if (role !== 'editor' && role !== 'admin') {
        // Treat it as a suggestion instead of applying.
        const suggestion = {
          id: crypto.randomUUID(),
          fromPeerId: sourcePeerId,
          fromName: author || 'Suggester',
          kind: 'file',
          filePath: path,
          content,
          baseRev,
          createdAt: new Date().toISOString()
        }
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id ? { ...p, suggestions: [suggestion, ...(p.suggestions || [])] } : p
          )
        )
        notifyConflict({ local: { title: 'New suggestion received' } })
        return
      }
    }

    const currentRev = (project.fileRevisions || {})[path] || 1
    if (typeof baseRev === 'number' && baseRev > 0 && baseRev !== currentRev) {
      const localContent = await window.projectBrain.readFile({
        rootPath: project.projectRoot,
        relativePath: path
      })
      const mergedContent = await mergeFileContentsWithBot({
        filePath: path,
        localContent: localContent ?? '',
        incomingContent: content ?? ''
      })

      notifyConflict({ local: { title: path } })

      const okMerge = await window.projectBrain.writeFile({
        rootPath: project.projectRoot,
        relativePath: path,
        content: mergedContent
      })
      if (!okMerge) return

      const nextRev = currentRev + 1
      const stamp = new Date().toISOString()
      const fileMapHas = (project.fileMap || []).some((f) => f.path === path)
      const updatedProject = {
        ...project,
        fileRevisions: { ...(project.fileRevisions || {}), [path]: nextRev },
        fileMap: fileMapHas
          ? (project.fileMap || []).map((file) => (file.path === path ? { ...file, updatedAt: stamp } : file))
          : [
              { id: crypto.randomUUID(), path, summary: `Added by ${author || 'collaborator'}`, updatedAt: stamp },
              ...(project.fileMap || [])
            ],
        updatedAt: stamp
      }
      updateProject(updatedProject)
      broadcastProject(updatedProject)
      broadcastChat({
        type: 'chat',
        author: 'Project Brain',
        message: `File conflict auto-merged for "${path}".`,
        createdAt: stamp
      })
      appendAutoMemory(project.id, {
        id: crypto.randomUUID(),
        title: `File conflict merged: ${path}`,
        body: `Merged competing edits automatically.\nAuthor: ${author || 'collaborator'}.\nRev ${currentRev} → ${nextRev}.`,
        tags: normalizeTags([...fileTagsFromPath(path), 'conflict-merge']),
        moduleId: autoFileMemoryModuleIdForPath(project, path),
        createdAt: stamp,
        updatedAt: stamp
      })
      sendToPeer(sourcePeerId, { type: 'file_applied', path, rev: nextRev })
      return
    }

    const before = await window.projectBrain.readFile({
      rootPath: project.projectRoot,
      relativePath: path
    })
    const ok = await window.projectBrain.writeFile({
      rootPath: project.projectRoot,
      relativePath: path,
      content
    })
    if (!ok) {
      setFileStatus('Host failed to write file')
      return
    }
    const nextRev = currentRev + 1
    const stamp = new Date().toISOString()
    const fileMapHas = (project.fileMap || []).some((f) => f.path === path)
    const updatedFileMap = fileMapHas
      ? (project.fileMap || []).map((file) =>
          file.path === path
            ? { ...file, summary: `Updated by ${author || 'collaborator'}`, updatedAt: stamp }
            : file
        )
      : [
          {
            id: crypto.randomUUID(),
            path,
            summary: `Added by ${author || 'collaborator'}`,
            updatedAt: stamp
          },
          ...(project.fileMap || [])
        ]
    const updatedProject = {
      ...project,
      fileMap: updatedFileMap,
      fileRevisions: { ...(project.fileRevisions || {}), [path]: nextRev },
      updatedAt: stamp
    }
    updateProject(updatedProject)
    broadcastProject(updatedProject)
    broadcastChat({ type: 'file_applied', path, rev: nextRev, author })
    if ((content || '').length <= 200_000) {
      for (const [, channel] of dataChannelsRef.current.entries()) {
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'file_content_update', path, content, rev: nextRev }))
        }
      }
    }

    const delta = summarizeLineDelta(before ?? '', content ?? '')
    appendAutoMemory(project.id, {
      id: crypto.randomUUID(),
      title: `File edit: ${path}`,
      body: `Edited by ${author || 'collaborator'}.\nRev ${currentRev} → ${nextRev}.\nLines: ${delta.beforeLines} → ${delta.afterLines} (added ~${delta.added}, removed ~${delta.removed}).`,
      tags: fileTagsFromPath(path),
      moduleId: autoFileMemoryModuleIdForPath(project, path),
      createdAt: stamp,
      updatedAt: stamp
    })
  }

  function broadcastProject(project, excludeId) {
    const payload = {
      type: 'project_sync',
      project
    }
    for (const [id, channel] of dataChannelsRef.current.entries()) {
      if (excludeId && id === excludeId) continue
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(payload))
      }
    }
  }

  function broadcastSuggestion(project, excludeId) {
    const payload = {
      type: 'project_suggestion',
      project
    }
    for (const [id, channel] of dataChannelsRef.current.entries()) {
      if (excludeId && id === excludeId) continue
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(payload))
      }
    }
  }

  function sendSignal(payload) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return
    socketRef.current.send(JSON.stringify(payload))
  }

  function ensurePeerConnection(isHost, targetId, targetName) {
    if (peerConnectionsRef.current.has(targetId)) {
      return peerConnectionsRef.current.get(targetId)
    }
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    peerConnectionsRef.current.set(targetId, peer)
    if (targetName) addPeer(targetId, targetName)

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: 'ice_candidate', targetId, candidate: event.candidate })
      }
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        updateCollabStatus()
      }
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        teardownPeer(targetId)
      }
    }

    if (isHost) {
      const channel = peer.createDataChannel('project-brain-chat')
      dataChannelsRef.current.set(targetId, channel)
      channel.onopen = () => {
        addPeer(targetId, targetName || 'Peer')
        ensureCollaboratorForPeer(targetId, targetName || 'Collaborator')
        updateCollabStatus()
        const project = activeProjectRef.current
        if (project && collabRole === 'host') {
          broadcastProject(project, null)
        }
        // Push the current role to the peer so their UI/permissions update immediately.
        if (project && collabRole === 'host') {
          const role = (project.collaborators || []).find((c) => c.peerId === targetId)?.role
          if (role) {
            try {
              channel.send(JSON.stringify({ type: 'role_update', role }))
            } catch {
              // no-op
            }
          }
        }
      }
      channel.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'role_update' && payload.role) {
            setLocalRole(payload.role)
            setAiStatus(`Role updated: ${payload.role}`)
            setTimeout(() => setAiStatus(''), 1800)
          }
          if (payload.type === 'file_content_update' && payload.path) {
            // Update local view if user has this file open.
            if (payload.path === selectedFilePath) {
              setFileContent(payload.content || '')
              if (payload.rev) setSelectedFileRev(payload.rev)
              setFileStatus(`Updated from host (rev ${payload.rev || ''})`.trim())
            }
            if (payload.rev) {
              const project = activeProjectRef.current
              if (project) {
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === project.id
                      ? {
                          ...p,
                          fileRevisions: {
                            ...(p.fileRevisions || {}),
                            [payload.path]: payload.rev
                          }
                        }
                      : p
                  )
                )
              }
            }
          }
          if (payload.type === 'chat' && activeProjectRef.current) {
            appendChatMessage(activeProjectRef.current.id, {
              id: crypto.randomUUID(),
              author: payload.author,
              message: payload.message,
              createdAt: new Date().toISOString()
            })
            if (collabRole === 'host') {
              broadcastChat(payload, targetId)
            }
          }
          if (payload.type === 'project_sync' && activeProjectRef.current) {
            isApplyingRemoteRef.current = true
            applyIncomingProject(payload.project, targetId)
          }
          if (payload.type === 'project_suggestion' && activeProjectRef.current) {
            if (collabRole === 'host') {
              const suggestion = {
                id: crypto.randomUUID(),
                fromPeerId: targetId,
                fromName: peers.find((peer) => peer.id === targetId)?.name || 'Collaborator',
                kind: 'project',
                project: payload.project,
                createdAt: new Date().toISOString()
              }
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === activeProjectRef.current.id
                    ? { ...p, suggestions: [suggestion, ...(p.suggestions || [])] }
                    : p
                )
              )
              notifyConflict({ local: { title: 'New suggestion received' } })
            }
          }
          if (payload.type === 'file_update' && collabRole === 'host') {
            applyFileUpdate(payload.path, payload.content, payload.author, targetId, payload.baseRev)
          }
          if (payload.type === 'file_suggestion' && collabRole === 'host') {
            const suggestion = {
              id: crypto.randomUUID(),
              fromPeerId: targetId,
              fromName: payload.author || 'Suggester',
              kind: 'file',
              filePath: payload.path,
              content: payload.content,
              baseRev: payload.baseRev,
              createdAt: new Date().toISOString()
            }
            setProjects((prev) =>
              prev.map((p) =>
                p.id === activeProjectRef.current.id
                  ? { ...p, suggestions: [suggestion, ...(p.suggestions || [])] }
                  : p
              )
            )
            notifyConflict({ local: { title: 'New suggestion received' } })
          }
          if (payload.type === 'file_request' && collabRole === 'host') {
            const project = activeProjectRef.current
            if (project?.projectRoot && window.projectBrain?.readFile) {
              const content = await window.projectBrain.readFile({
                rootPath: project.projectRoot,
                relativePath: payload.path
              })
              sendToPeer(targetId, {
                type: 'file_content',
                path: payload.path,
                content: content ?? '',
                rev: (project.fileRevisions || {})[payload.path] || 1,
                requestId: payload.requestId
              })
            }
          }
          if (payload.type === 'file_content') {
            const requestedPath = pendingFileRequestsRef.current.get(payload.requestId)
            if (requestedPath && requestedPath === payload.path) {
              pendingFileRequestsRef.current.delete(payload.requestId)
              setSelectedFilePath(payload.path)
              setFileContent(payload.content || '')
              setSelectedFileRev(payload.rev || 1)
              setFileStatus('')
            }
            const resolver = fileRequestPromisesRef.current.get(payload.requestId)
            if (resolver) resolver(payload)
          }
          if (payload.type === 'file_applied' && payload.path) {
            const project = activeProjectRef.current
            if (project) {
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === project.id
                    ? {
                        ...p,
                        fileRevisions: {
                          ...(p.fileRevisions || {}),
                          [payload.path]: payload.rev || (p.fileRevisions || {})[payload.path] || 1
                        }
                      }
                    : p
                )
              )
            }
            if (payload.path === selectedFilePath && payload.rev) {
              setSelectedFileRev(payload.rev)
              setFileStatus(`Applied on host (rev ${payload.rev})`)
            }
          }
        } catch {
          // no-op
        }
      }
    } else {
      peer.ondatachannel = (event) => {
        dataChannelsRef.current.set(targetId, event.channel)
        event.channel.onopen = () => {
          addPeer(targetId, targetName || 'Host')
          updateCollabStatus()
        }
        event.channel.onmessage = async (evt) => {
          try {
            const payload = JSON.parse(evt.data)
            if (payload.type === 'role_update' && payload.role) {
              setLocalRole(payload.role)
              setAiStatus(`Role updated: ${payload.role}`)
              setTimeout(() => setAiStatus(''), 1800)
            }
            if (payload.type === 'file_content_update' && payload.path) {
              if (payload.path === selectedFilePath) {
                setFileContent(payload.content || '')
                if (payload.rev) setSelectedFileRev(payload.rev)
                setFileStatus(`Updated from host (rev ${payload.rev || ''})`.trim())
              }
              if (payload.rev) {
                const project = activeProjectRef.current
                if (project) {
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === project.id
                        ? {
                            ...p,
                            fileRevisions: {
                              ...(p.fileRevisions || {}),
                              [payload.path]: payload.rev
                            }
                          }
                        : p
                    )
                  )
                }
              }
            }
            if (payload.type === 'chat' && activeProjectRef.current) {
              appendChatMessage(activeProjectRef.current.id, {
                id: crypto.randomUUID(),
                author: payload.author,
                message: payload.message,
                createdAt: new Date().toISOString()
              })
            }
            if (payload.type === 'project_sync' && activeProjectRef.current) {
              isApplyingRemoteRef.current = true
              applyIncomingProject(payload.project, targetId)
            }
            if (payload.type === 'project_suggestion' && activeProjectRef.current) {
              if (collabRole === 'host') {
                const suggestion = {
                  id: crypto.randomUUID(),
                  fromPeerId: targetId,
                  fromName: peers.find((peer) => peer.id === targetId)?.name || 'Collaborator',
                  kind: 'project',
                  project: payload.project,
                  createdAt: new Date().toISOString()
                }
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === activeProjectRef.current.id
                      ? { ...p, suggestions: [suggestion, ...(p.suggestions || [])] }
                      : p
                  )
                )
                notifyConflict({ local: { title: 'New suggestion received' } })
              }
            }
            if (payload.type === 'file_update' && collabRole === 'host') {
              applyFileUpdate(payload.path, payload.content, payload.author, targetId, payload.baseRev)
            }
            if (payload.type === 'file_suggestion' && collabRole === 'host') {
              const suggestion = {
                id: crypto.randomUUID(),
                fromPeerId: targetId,
                fromName: payload.author || 'Suggester',
                kind: 'file',
                filePath: payload.path,
                content: payload.content,
                baseRev: payload.baseRev,
                createdAt: new Date().toISOString()
              }
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === activeProjectRef.current.id
                    ? { ...p, suggestions: [suggestion, ...(p.suggestions || [])] }
                    : p
                )
              )
              notifyConflict({ local: { title: 'New suggestion received' } })
            }
            if (payload.type === 'file_request' && collabRole === 'host') {
              const project = activeProjectRef.current
              if (project?.projectRoot && window.projectBrain?.readFile) {
                const content = await window.projectBrain.readFile({
                  rootPath: project.projectRoot,
                  relativePath: payload.path
                })
                sendToPeer(targetId, {
                  type: 'file_content',
                  path: payload.path,
                  content: content ?? '',
                  rev: (project.fileRevisions || {})[payload.path] || 1,
                  requestId: payload.requestId
                })
              }
            }
            if (payload.type === 'file_content') {
              const requestedPath = pendingFileRequestsRef.current.get(payload.requestId)
              if (requestedPath && requestedPath === payload.path) {
                pendingFileRequestsRef.current.delete(payload.requestId)
                setSelectedFilePath(payload.path)
                setFileContent(payload.content || '')
                setSelectedFileRev(payload.rev || 1)
                setFileStatus('')
              }
              const resolver = fileRequestPromisesRef.current.get(payload.requestId)
              if (resolver) resolver(payload)
            }
            if (payload.type === 'file_applied' && payload.path) {
              const project = activeProjectRef.current
              if (project) {
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === project.id
                      ? {
                          ...p,
                          fileRevisions: {
                            ...(p.fileRevisions || {}),
                            [payload.path]: payload.rev || (p.fileRevisions || {})[payload.path] || 1
                          }
                        }
                      : p
                  )
                )
              }
              if (payload.path === selectedFilePath && payload.rev) {
                setSelectedFileRev(payload.rev)
                setFileStatus(`Applied on host (rev ${payload.rev})`)
              }
            }
          } catch {
            // no-op
          }
        }
      }
    }

    return peer
  }

  function handleSignalMessage(message) {
    if (!message?.type) return

    if (message.type === 'registered') {
      setCollabStatus('waiting')
      return
    }

    if (message.type === 'join_request' && collabRole === 'host') {
      const request = {
        id: message.requestId,
        name: message.name,
        code: message.code,
        peerId: message.peerId,
        role: 'viewer',
        createdAt: new Date().toISOString()
      }
      const project = activeProjectRef.current
      if (project) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id
              ? { ...p, joinRequests: [request, ...(p.joinRequests || [])] }
              : p
          )
        )
      }
    }

    if (message.type === 'join_accepted' && collabRole === 'client') {
      if (message.hostId) {
        ensurePeerConnection(false, message.hostId, message.hostName || 'Host')
      }
      if (message.role) {
        setLocalRole(message.role)
      }
    }

    if (message.type === 'role_update') {
      if (message.role) {
        setLocalRole(message.role)
        setAiStatus(`Role updated: ${message.role}`)
        setTimeout(() => setAiStatus(''), 1800)
      }
    }

    if (message.type === 'join_rejected' || message.type === 'host_offline') {
      setCollabStatus('offline')
      teardownPeer()
    }

    if (message.type === 'webrtc_offer') {
      const peer = ensurePeerConnection(false, message.fromId, message.fromName)
      peer.setRemoteDescription(new RTCSessionDescription(message.offer)).then(async () => {
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        sendSignal({ type: 'webrtc_answer', targetId: message.fromId, answer })
      })
    }

    if (message.type === 'webrtc_answer' && message.fromId) {
      const peer = peerConnectionsRef.current.get(message.fromId)
      if (peer) {
        peer.setRemoteDescription(new RTCSessionDescription(message.answer))
      }
    }

    if (message.type === 'ice_candidate' && message.fromId) {
      const peer = peerConnectionsRef.current.get(message.fromId)
      if (peer) {
        try {
          peer.addIceCandidate(new RTCIceCandidate(message.candidate))
        } catch {
          // no-op
        }
      }
    }
  }

  function connectToSignaling(role, code, name, urlOverride) {
    const url = urlOverride || serverUrl
    if (!url || !url.startsWith('ws')) {
      setAiStatus('Set a valid ws:// or wss:// signaling URL first.')
      return
    }
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }

    const socket = new WebSocket(url)
    socketRef.current = socket
    setCollabStatus('connecting')
    setCollabRole(role)

    socket.onopen = () => {
      sendSignal({ type: 'register', role, code, name })
      updateCollabStatus()
    }

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        handleSignalMessage(message)
      } catch {
        // no-op
      }
    }

    socket.onclose = () => {
      setCollabStatus('offline')
      setCollabRole('idle')
      teardownPeer()
    }

    socket.onerror = () => {
      // Force onclose to run and reset role/permissions.
      try {
        socket.close()
      } catch {
        // no-op
      }
      setCollabStatus('offline')
    }
  }

  function disconnectCollab() {
    if (socketRef.current) {
      try {
        socketRef.current.close()
      } catch {
        // no-op
      }
      socketRef.current = null
    }
    teardownPeer()
    setCollabRole('idle')
    setCollabStatus('offline')
  }

  function encodeConnectCode(payload) {
    try {
      const json = JSON.stringify(payload)
      const ascii = encodeURIComponent(json)
      return btoa(ascii)
    } catch {
      return ''
    }
  }

  function decodeConnectCode(code) {
    try {
      const json = decodeURIComponent(atob(code.trim()))
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  function waitForIceComplete(peer, timeoutMs = 4000) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        peer.removeEventListener?.('icegatheringstatechange', onChange)
        resolve()
      }
      const onChange = () => {
        if (peer.iceGatheringState === 'complete') finish()
      }
      peer.addEventListener?.('icegatheringstatechange', onChange)
      setTimeout(finish, timeoutMs)
    })
  }

  async function directHostGenerateOffer() {
    if (!activeProject?.inviteCode) return
    const offerId = crypto.randomUUID()
    directPendingRef.current = { offerId }
    setLocalRole('admin')
    setCollabRole('host')

    const peer = ensurePeerConnection(true, offerId, 'Direct peer')
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await waitForIceComplete(peer)

    const code = encodeConnectCode({
      v: 1,
      kind: 'offer',
      offerId,
      inviteCode: activeProject.inviteCode,
      hostName: account?.name || 'Host',
      sdp: peer.localDescription
    })
    setDirectOfferOut(code)
    setAiStatus('Offer generated. Send it to the person joining.')
    setTimeout(() => setAiStatus(''), 2000)
  }

  async function directJoinGenerateAnswer() {
    const offerMsg = decodeConnectCode(directOfferIn)
    if (!offerMsg || offerMsg.kind !== 'offer' || !offerMsg.offerId || !offerMsg.sdp) {
      setAiStatus('Invalid offer code.')
      setTimeout(() => setAiStatus(''), 2000)
      return
    }
    setCollabRole('client')
    setLocalRole('viewer')

    const peer = ensurePeerConnection(false, offerMsg.offerId, offerMsg.hostName || 'Host')
    await peer.setRemoteDescription(new RTCSessionDescription(offerMsg.sdp))
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await waitForIceComplete(peer)

    const code = encodeConnectCode({
      v: 1,
      kind: 'answer',
      offerId: offerMsg.offerId,
      name: account?.name || 'Client',
      sdp: peer.localDescription
    })
    setDirectAnswerOut(code)
    setAiStatus('Answer generated. Send it back to the host.')
    setTimeout(() => setAiStatus(''), 2000)
  }

  async function directHostAcceptAnswer() {
    const ans = decodeConnectCode(directAnswerIn)
    if (!ans || ans.kind !== 'answer' || !ans.offerId || !ans.sdp) {
      setAiStatus('Invalid answer code.')
      setTimeout(() => setAiStatus(''), 2000)
      return
    }
    const peer = peerConnectionsRef.current.get(ans.offerId)
    if (!peer) {
      setAiStatus('No pending offer found for this answer. Generate a new offer.')
      setTimeout(() => setAiStatus(''), 2400)
      return
    }
    await peer.setRemoteDescription(new RTCSessionDescription(ans.sdp))
    setAiStatus('Direct connection completed.')
    setTimeout(() => setAiStatus(''), 1800)
  }

  async function startHostSession() {
    if (!activeProject?.inviteCode) return
    setLocalRole('admin')
    // Zero-setup default: start a local signaling server if the user hasn't configured one yet.
    if (!serverUrl || serverUrl.includes('your-signal-server')) {
      const res = await window.projectBrain?.signalStartLocal?.()
      if (res?.ok) {
        const preferred = (res.lanUrls && res.lanUrls[0]) || (res.urls && res.urls[0])
        if (preferred) {
          setServerUrl(preferred)
          setAiStatus(`Local signaling server started (LAN): ${preferred}`)
          setTimeout(() => setAiStatus(''), 2600)
          connectToSignaling('host', activeProject.inviteCode, account?.name || 'Host', preferred)
          return
        }
      } else {
        setAiStatus(res?.detail || 'Unable to start local signaling server.')
        setTimeout(() => setAiStatus(''), 2200)
        return
      }
    }
    connectToSignaling('host', activeProject.inviteCode, account?.name || 'Host')
  }

  async function startJoinSession(code, name) {
    connectToSignaling('client', code, name)
  }

  function setCollaboratorRole(peerId, role) {
    if (!activeProject) return
    if (!canManage) return
    const existing = (activeProject.collaborators || []).find((c) => c.peerId === peerId)
    const updated = {
      ...activeProject,
      collaborators: existing
        ? (activeProject.collaborators || []).map((c) => (c.peerId === peerId ? { ...c, role } : c))
        : [
            ...(activeProject.collaborators || []),
            {
              id: crypto.randomUUID(),
              name: peers.find((p) => p.id === peerId)?.name || 'Collaborator',
              status: 'active',
              role,
              peerId
            }
          ],
      updatedAt: new Date().toISOString()
    }
    updateProject(updated)

    // Notify peer immediately if connected; fall back to signaling.
    const channel = dataChannelsRef.current.get(peerId)
    if (channel && channel.readyState === 'open') {
      try {
        channel.send(JSON.stringify({ type: 'role_update', role }))
      } catch {
        // no-op
      }
      return
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      sendSignal({ type: 'role_update', targetId: peerId, role })
    }
  }

  function ensureCollaboratorForPeer(peerId, name) {
    const project = activeProjectRef.current
    if (!project) return
    if (collabRole !== 'host') return
    if (!canManage) return
    const exists = (project.collaborators || []).some((c) => c.peerId === peerId)
    if (exists) return
    updateProject({
      ...project,
      collaborators: [
        ...(project.collaborators || []),
        { id: crypto.randomUUID(), name: name || 'Collaborator', status: 'active', role: 'viewer', peerId }
      ],
      updatedAt: new Date().toISOString()
    })
  }

  function handleCreateAccount(event) {
    event.preventDefault()
    const form = event.target
    const name = form.displayName.value.trim()
    const handle = form.handle.value.trim()
    if (!name || !handle) return
    const accountData = {
      id: crypto.randomUUID(),
      name,
      handle
    }
    setAccount(accountData)
    saveAccount(accountData)
  }

  function commitSetupAccount() {
    const name = String(setupName || '').trim()
    const handle = String(setupHandle || '').trim()
    if (!name || !handle) return
    const accountData = {
      id: crypto.randomUUID(),
      name,
      handle
    }
    setAccount(accountData)
    saveAccount(accountData)
  }

  async function handleExportData() {
    if (!window.projectBrain?.saveFile) return
    const payload = {
      account,
      projects,
      exportedAt: new Date().toISOString()
    }
    await window.projectBrain.saveFile(payload)
  }

  async function handleImportData() {
    if (!window.projectBrain?.openFile) return
    const content = await window.projectBrain.openFile()
    if (!content) return
    try {
      const parsed = JSON.parse(content)
      if (parsed.account) {
        setAccount(parsed.account)
        saveAccount(parsed.account)
      }
      if (Array.isArray(parsed.projects)) {
        setProjects(parsed.projects)
        setSelectedProjectId(parsed.projects[0]?.id ?? null)
        setSelectedNoteId(parsed.projects[0]?.notes?.[0]?.id ?? null)
      }
    } catch {
      // invalid file
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  async function handleSaveOpenAIKey(event) {
    event.preventDefault()
    if (!window.projectBrain?.secretsSet) return
    const key = openAIKeyInput.trim()
    if (!key) return
    const ok = await window.projectBrain.secretsSet({ key: 'openai_api_key', value: key })
    setOpenAIKeyPresent(Boolean(ok))
    setOpenAIKeyInput('')
    setAiStatus(ok ? 'OpenAI key saved.' : 'Unable to save key on this device.')
  }

  async function handleClearOpenAIKey() {
    if (!window.projectBrain?.secretsClear) return
    await window.projectBrain.secretsClear({ key: 'openai_api_key' })
    setOpenAIKeyPresent(false)
    setAiStatus('OpenAI key cleared.')
  }

  function extractResponseText(json) {
    if (!json) return ''
    if (typeof json.output_text === 'string') return json.output_text
    const output = json.output
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          const textParts = item.content
            .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
            .map((c) => c.text)
          if (textParts.length > 0) return textParts.join('\n')
        }
      }
    }
    return ''
  }

  async function callOpenAIJSON({ model, instructions, input }) {
    if (!window.projectBrain?.secretsGet) return null
    const apiKey = await window.projectBrain.secretsGet({ key: 'openai_api_key' })
    if (!apiKey) return null

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions,
        input
      })
    })

    if (!response.ok) return null
    const json = await response.json()
    const text = extractResponseText(json)
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  async function callOpenAIText({ model, instructions, input }) {
    if (!window.projectBrain?.secretsGet) return null
    const apiKey = await window.projectBrain.secretsGet({ key: 'openai_api_key' })
    if (!apiKey) return null

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions,
        input
      })
    })

    if (!response.ok) return null
    const json = await response.json()
    const text = extractResponseText(json)
    return text || null
  }

  async function buildAIContext(scope) {
    const project = activeProjectRef.current
    if (!project) return null

    const moduleChoice =
      project.selectedModuleId && project.selectedModuleId !== 'all'
        ? project.selectedModuleId
        : project.defaultModuleId
    const moduleSet = moduleChoice ? collectDescendantModuleIds(project.modules || [], moduleChoice) : null
    const moduleNotes = (project.notes || []).filter((n) => {
      const mid = n.moduleId || project.defaultModuleId
      return !moduleSet || (mid && moduleSet.has(mid))
    })

    const context = {
      project: {
        id: project.id,
        name: project.name,
        overview: buildProjectOverview(project),
        projectRoot: project.projectRoot ? '(set)' : '(not set)',
        moduleFocus: moduleChoice
      },
      files: {
        fileMap: (project.fileMap || []).map((f) => ({ path: f.path, summary: f.summary }))
      },
      memories: {
        recent: moduleNotes.slice(0, 12).map((n) => ({ title: n.title, tags: n.tags, summary: buildSummary(n) })),
        condensed: (project.condensed || []).slice(0, 12)
      }
    }

    const canReadDisk = isHostLike && project.projectRoot && window.projectBrain?.readFile
    const canRequestHost =
      collabRole === 'client' &&
      (localRole === 'editor' || localRole === 'admin' || localRole === 'suggester') &&
      dataChannelsRef.current.size > 0
    if (!canReadDisk && !canRequestHost) return context

    async function getText(path) {
      if (!path) return ''
      if (canReadDisk) {
        const content = await window.projectBrain.readFile({ rootPath: project.projectRoot, relativePath: path })
        return String(content ?? '')
      }
      const res = await requestFileFromHost(path)
      return String(res?.content ?? '')
    }

    async function buildBundle(paths, maxFiles, maxTotalChars) {
      let total = 0
      const bundle = []
      for (const p of paths.slice(0, maxFiles)) {
        const text = await getText(p)
        const remaining = maxTotalChars - total
        if (remaining <= 0) break
        const clipped = text.length > remaining ? text.slice(0, remaining) : text
        bundle.push({ path: p, content: clipped })
        total += clipped.length
      }
      return bundle
    }

    if (scope === 'selected' && selectedFilePath) {
      const content = await getText(selectedFilePath)
      context.files.selected = {
        path: selectedFilePath,
        content: content ?? ''
      }
      // Auto-upload a small related bundle for host/admin/editor clarity.
      const relatedPaths = (project.fileMap || [])
        .map((f) => f.path)
        .filter((p) => p && p !== selectedFilePath)
      const related = await buildBundle(relatedPaths, 12, 40_000)
      if (related.length) context.files.bundle = related
      return context
    }

    if (scope === 'all') {
      const paths = (project.fileMap || []).map((f) => f.path)
      const maxFiles = canReadDisk ? 40 : 20
      const maxTotalChars = canReadDisk ? 120_000 : 80_000
      context.files.bundle = await buildBundle(paths, maxFiles, maxTotalChars)
    }

    // If user didn't select a file but we're in "selected" scope, still include a small bundle so AI can work.
    if (scope === 'selected' && !selectedFilePath) {
      const paths = (project.fileMap || []).map((f) => f.path)
      context.files.bundle = await buildBundle(paths, canReadDisk ? 16 : 10, canReadDisk ? 60_000 : 40_000)
    }

    return context
  }

  function captureAiIntentMemory(project, prompt, replyText, editPaths) {
    if (!project) return
    if (!canEdit) return
    const inferred = inferModuleIdFromFilePath(project, (editPaths || []).find(Boolean))
    const moduleId =
      inferred ||
      (project.selectedModuleId && project.selectedModuleId !== 'all'
        ? project.selectedModuleId
        : project.defaultModuleId)
    const paths = Array.from(new Set((editPaths || []).filter(Boolean))).slice(0, 12)
    const pathTags = normalizeTags(paths.flatMap((p) => fileTagsFromPath(p))).slice(0, 12)
    const now = new Date().toISOString()
    const note = {
      id: crypto.randomUUID(),
      title: `AI intent: ${String(prompt).slice(0, 80)}`,
      body:
        `Prompt:\n${prompt}\n\n` +
        (paths.length ? `Files:\n${paths.map((p) => `- ${p}`).join('\n')}\n\n` : '') +
        (replyText ? `AI reply (first line):\n${String(replyText).split('\n')[0]}` : ''),
      tags: normalizeTags(['ai', 'intent', ...pathTags]),
      moduleId: moduleId || project.defaultModuleId,
      createdAt: now,
      updatedAt: now
    }

    if (collabRole === 'client') {
      updateProject({
        ...project,
        notes: [note, ...(project.notes || [])],
        scanCounter: (project.scanCounter || 0) + 1,
        updatedAt: now
      })
    } else {
      appendAutoMemory(project.id, note)
    }
  }

  async function runProjectAICommand() {
    const project = activeProjectRef.current
    if (!project) return
    const prompt = aiPrompt.trim()
    if (!prompt) return

    setAiConsoleBusy(true)
    setAiConsoleReply('')
    try {
      const provider = project.ai?.provider || 'local'
      const model = project.ai?.model || 'gpt-5-codex'
      const scope = aiConsoleScope
      const context = await buildAIContext(scope)

      const instructions =
        'You are Project Brain, an AI coding agent embedded in a desktop app. Return ONLY JSON with keys: reply (string) and edits (array). ' +
        'Each edit is {path:string, content:string}. If no file changes are needed, return edits as an empty array. ' +
        'If asked to modify a file, output the FULL updated file content. You MAY create new files: choose a new path and output the full content. ' +
        'Keep changes minimal and precise.'

      const input = JSON.stringify({ prompt, scope, context })

      let result = null
      if (provider === 'openai') {
        result = await callOpenAIJSON({ model, instructions, input })
      } else if (provider === 'ollama') {
        // Requires Ollama to be running locally.
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: project.ai?.localModel || 'qwen2.5-coder:7b',
            stream: false,
            prompt: `${instructions}\n\n${input}`
          })
        })
        if (response.ok) {
          const json = await response.json()
          try {
            result = JSON.parse(json?.response || 'null')
          } catch {
            result = null
          }
        }
      } else if (provider === 'builtin') {
        // Built-in llama-server (OpenAI-like). User must start it in the AI section.
        const response = await fetch('http://127.0.0.1:8081/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: project.ai?.builtinModelFile || 'local-model',
            messages: [{ role: 'user', content: `${instructions}\n\n${input}` }],
            temperature: 0.2
          })
        })
        if (response.ok) {
          const json = await response.json()
          const text = json?.choices?.[0]?.message?.content
          try {
            result = JSON.parse(text || 'null')
          } catch {
            result = null
          }
        }
      } else {
        setAiConsoleReply('Local bot is enabled, but it can’t rewrite files yet. Switch Project AI to OpenAI/Ollama/Built-in LLM.')
        return
      }

      if (!result || typeof result.reply !== 'string' || !Array.isArray(result.edits)) {
        setAiConsoleReply('AI response was not valid JSON (expected {reply, edits}).')
        return
      }

      setAiConsoleReply(result.reply)
      captureAiIntentMemory(activeProjectRef.current, prompt, result.reply, (result.edits || []).map((e) => e?.path))

      if (result.edits.length > 0) {
        // Host can apply directly to disk. Clients can send edits to host (editor/admin) or as suggestions.
        if (isHostLike) {
          if (!project.projectRoot) {
            setAiStatus('Set the project root first, then rerun AI edits.')
            setTimeout(() => setAiStatus(''), 2400)
            return
          }
          for (const edit of result.edits) {
            if (!edit?.path || typeof edit.content !== 'string') continue
            const latest = activeProjectRef.current
            const currentRev = (latest?.fileRevisions || {})[edit.path] || 1
            await applyFileUpdate(edit.path, edit.content, 'AI', null, currentRev)
          }
          setAiStatus(`Applied ${result.edits.length} file edit(s) from AI.`)
          setTimeout(() => setAiStatus(''), 2000)
          return
        }

        if (dataChannelsRef.current.size === 0) {
          setAiStatus('AI produced edits, but you are not connected to a host.')
          setTimeout(() => setAiStatus(''), 2400)
          return
        }

        const latest = activeProjectRef.current
        for (const edit of result.edits) {
          if (!edit?.path || typeof edit.content !== 'string') continue
          const baseRev = (latest?.fileRevisions || {})[edit.path] || 1
          if (localRole === 'editor' || localRole === 'admin') {
            sendToHost({ type: 'file_update', path: edit.path, content: edit.content, baseRev, author: account?.name || 'AI' })
          } else {
            sendToHost({ type: 'file_suggestion', path: edit.path, content: edit.content, baseRev, author: account?.name || 'AI' })
          }
        }
        setAiStatus(`Sent ${result.edits.length} AI edit(s) to host.`)
        setTimeout(() => setAiStatus(''), 2200)
      }
    } catch {
      setAiConsoleReply('AI request failed. Check your provider setup.')
    } finally {
      setAiConsoleBusy(false)
    }
  }

  async function applyHostEditsFromAI(edits, authorLabel) {
    const project = activeProjectRef.current
    if (!project?.projectRoot) {
      setAiStatus('Set the project root first (File map → Set Root).')
      setTimeout(() => setAiStatus(''), 2400)
      return false
    }
    if (!window.projectBrain?.readFile || !window.projectBrain?.writeFile) {
      setAiStatus('File access is unavailable in this build.')
      setTimeout(() => setAiStatus(''), 2400)
      return false
    }

    const applied = []
    for (const edit of edits || []) {
      const path = String(edit?.path || '').trim().replace(/^[/\\]+/, '')
      if (!path) continue

      const action = edit?.action || (typeof edit?.content === 'string' ? 'overwrite' : 'patch')
      const before = await window.projectBrain.readFile({ rootPath: project.projectRoot, relativePath: path })
      const beforeText = before ?? ''
      const afterText = applyStructuredEdit(beforeText, { ...edit, action })

      // Apply to disk through the same host pipeline (handles revisions + auto-memories + peer streaming).
      const latest = activeProjectRef.current
      const currentRev = (latest?.fileRevisions || {})[path] || 1
      await applyFileUpdate(path, afterText, authorLabel || 'AI', null, currentRev)
      applied.push(path)
    }

    return applied.length > 0
  }

  async function dispatchEditsFromAI(edits, authorLabel) {
    const project = activeProjectRef.current
    if (!project) return false

    if (isHostLike) {
      return applyHostEditsFromAI(edits, authorLabel)
    }

    if (dataChannelsRef.current.size === 0) {
      setAiStatus('Not connected to a host. Use Direct Connect or Host a session.')
      setTimeout(() => setAiStatus(''), 2600)
      return false
    }

    // Non-host: send edits to host. Editors/admins send updates; others send suggestions.
    const latest = activeProjectRef.current
    for (const edit of edits || []) {
      const path = String(edit?.path || '').trim().replace(/^[/\\]+/, '')
      if (!path) continue

      const action = edit?.action || (typeof edit?.content === 'string' ? 'overwrite' : 'patch')
      let content = ''

      if (action === 'overwrite') {
        content = String(edit.content ?? '')
      } else {
        // For patch/append we need the current file content to produce a full updated version.
        const { content: beforeText } = await requestFileFromHost(path)
        content = applyStructuredEdit(beforeText ?? '', { ...edit, action })
      }

      const baseRev = (latest?.fileRevisions || {})[path] || 1
      if (localRole === 'editor' || localRole === 'admin') {
        sendToHost({ type: 'file_update', path, content, baseRev, author: authorLabel || account?.name || 'AI' })
      } else {
        sendToHost({ type: 'file_suggestion', path, content, baseRev, author: authorLabel || account?.name || 'AI' })
      }
    }
    return true
  }

  async function runAiOnlyFlow() {
    const project = activeProjectRef.current
    if (!project) return
    const prompt = aiOnlyPrompt.trim()
    if (!prompt) return

    const provider = project.ai?.provider || 'local'
    if (provider === 'local') {
      setAiStatus('AI-only mode requires an LLM provider (OpenAI, Ollama, or Built-in LLM).')
      setTimeout(() => setAiStatus(''), 2600)
      return
    }

    setAiOnlyBusy(true)
    setAiStatus('AI is planning changes…')

    try {
      const context = await buildAIContext('all')
        const instructions =
          'You are Project Brain in AI-only mode for non-coders. ' +
          'Return ONLY JSON with keys: module_path (array of strings), memory (object), edits (array). ' +
          'memory must include: title, body, tags (array). ' +
          'edits items must be one of:\n' +
          '- {path, action:"overwrite", content}\n' +
          '- {path, action:"patch", find, replace} OR {path, action:"patch", before_context, after_context, replace}\n' +
          '- {path, action:"append", content}\n' +
          'You MAY create new files when needed: choose a new path and use action:"overwrite" with full content. ' +
          'If you need to change a file, choose the correct file path and make the smallest safe change. ' +
          'Prefer patch when possible. Avoid deleting unrelated code.'

      const model = project.ai?.model || 'gpt-5-codex'
      const input = JSON.stringify({ prompt, context })

      let result = null
      if (provider === 'openai') {
        result = await callOpenAIJSON({ model, instructions, input })
      } else if (provider === 'ollama') {
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: project.ai?.localModel || 'qwen2.5-coder:7b',
            stream: false,
            prompt: `${instructions}\n\n${input}`
          })
        })
        if (response.ok) {
          const json = await response.json()
          try {
            result = JSON.parse(json?.response || 'null')
          } catch {
            result = null
          }
        }
      } else if (provider === 'builtin') {
        const response = await fetch('http://127.0.0.1:8081/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: project.ai?.builtinModelFile || 'local-model',
            messages: [{ role: 'user', content: `${instructions}\n\n${input}` }],
            temperature: 0.2
          })
        })
        if (response.ok) {
          const json = await response.json()
          const text = json?.choices?.[0]?.message?.content
          try {
            result = JSON.parse(text || 'null')
          } catch {
            result = null
          }
        }
      }

      if (!result || !result.memory || !Array.isArray(result.edits)) {
        setAiStatus('AI-only response was invalid. Try again with a simpler request.')
        setTimeout(() => setAiStatus(''), 2600)
        return
      }

      // 1) Ensure module path exists and attach memory to it.
      let nextProject = activeProjectRef.current
      const modulePath = Array.isArray(result.module_path) ? result.module_path : []
      const created = findOrCreateModulePath(nextProject, modulePath)
      nextProject = created.project
      const fallbackFromFile = inferModuleIdFromFilePath(
        nextProject,
        (result.edits || []).map((e) => e?.path).find(Boolean)
      )
      const moduleId = created.moduleId || fallbackFromFile || nextProject.defaultModuleId
      nextProject = { ...nextProject, selectedModuleId: moduleId }
      updateProject(nextProject)

      // 2) Create the classified memory entry.
      const now = new Date().toISOString()
      const memory = {
        id: crypto.randomUUID(),
        title: String(result.memory.title || 'AI memory').slice(0, 120),
        body: String(result.memory.body || ''),
        tags: normalizeTags(result.memory.tags || []),
        moduleId,
        createdAt: now,
        updatedAt: now
      }
      if (collabRole === 'client') {
        // Client: update the project locally and let the existing sync logic send it (suggestion vs update) based on role.
        updateProject({
          ...nextProject,
          notes: [memory, ...(nextProject.notes || [])],
          scanCounter: (nextProject.scanCounter || 0) + 1,
          updatedAt: now
        })
      } else {
        // Host/solo: just append as a local memory.
        appendAutoMemory(nextProject.id, memory)
      }

      // 3) Apply edits to host project root.
      setAiStatus('Applying file changes…')
      const ok = await dispatchEditsFromAI(result.edits, 'AI')
      setAiStatus(ok ? 'Done. Changes sent/applied + memory captured.' : 'Done. Memory captured (no file edits).')
      setAiOnlyPrompt('')
      setTimeout(() => setAiStatus(''), 2400)
    } catch {
      setAiStatus('AI-only run failed. Check your AI provider setup.')
      setTimeout(() => setAiStatus(''), 2600)
    } finally {
      setAiOnlyBusy(false)
    }
  }


  function handleJoinRequest(event) {
    if (event?.preventDefault) event.preventDefault()
    if (!activeProject) return
    const code = inviteCodeInput.trim().toUpperCase()
    const name = inviteNameInput.trim()
    if (!code || !name) return
    if (!serverUrl || !serverUrl.startsWith('ws')) {
      setAiStatus('Set a valid ws:// or wss:// signaling URL first.')
      return
    }
    startJoinSession(code, name)
    setInviteCodeInput('')
    setInviteNameInput('')
  }

  function handleAcceptRequest(requestId) {
    if (!activeProject) return
    const request = activeProject.joinRequests.find((r) => r.id === requestId)
    if (!request) return
    const updatedRequests = activeProject.joinRequests.filter((r) => r.id !== requestId)
    const updatedCollaborators = [
      ...(activeProject.collaborators || []),
      {
        id: crypto.randomUUID(),
        name: request.name,
        status: 'active',
        role: request.role || 'viewer',
        peerId: request.peerId || null
      }
    ]
    updateProject({
      ...activeProject,
      joinRequests: updatedRequests,
      collaborators: updatedCollaborators
    })
    if (collabRole === 'host' && request.peerId) {
      const peer = ensurePeerConnection(true, request.peerId, request.name)
      peer.createOffer().then(async (offer) => {
        await peer.setLocalDescription(offer)
        sendSignal({
          type: 'webrtc_offer',
          targetId: request.peerId,
          offer,
          fromName: account?.name || 'Host'
        })
      })
      sendSignal({
        type: 'join_accept',
        targetId: request.peerId,
        requestId,
        role: request.role || 'viewer'
      })
    }
  }

  function handleRejectRequest(requestId) {
    if (!activeProject) return
    const updatedRequests = activeProject.joinRequests.filter((r) => r.id !== requestId)
    updateProject({
      ...activeProject,
      joinRequests: updatedRequests
    })
    if (collabRole === 'host') {
      const rejected = activeProject.joinRequests.find((r) => r.id === requestId)
      if (rejected?.peerId) {
        sendSignal({ type: 'join_reject', targetId: rejected.peerId, requestId })
      }
    }
  }

  function handleSendChat(event) {
    event.preventDefault()
    if (!activeProject || !chatInput.trim()) return
    const message = {
      id: crypto.randomUUID(),
      author: account?.name || 'Guest',
      message: chatInput.trim(),
      createdAt: new Date().toISOString()
    }
    updateProject({
      ...activeProject,
      chat: [...(activeProject.chat || []), message]
    })
    if (dataChannelsRef.current.size > 0) {
      broadcastChat({
        type: 'chat',
        author: message.author,
        message: message.message
      })
    }
    setChatInput('')
  }

  const memoryStats = useMemo(() => {
    const count = notes.length
    const tagCount = new Set(notes.flatMap((n) => n.tags)).size
    const lastUpdated = notes.map((n) => n.updatedAt).sort().at(-1)
    const condensedCount = activeProject?.condensed?.length || 0
    return { count, tagCount, lastUpdated, condensedCount }
  }, [notes, activeProject])

  const graphData = useMemo(() => {
    const sample = notes.slice(0, MAX_GRAPH_NODES)
    const nodes = sample.map((note, index) => {
      const angle = (index / sample.length) * Math.PI * 2
      return {
        id: note.id,
        label: note.title,
        x: 140 + Math.cos(angle) * 90,
        y: 140 + Math.sin(angle) * 90,
        tags: note.tags,
        words: normalizeText(note.title + ' ' + note.body)
      }
    })

    const edges = []
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const sharedTags = nodes[i].tags.filter((t) => nodes[j].tags.includes(t))
        const sharedWords = nodes[i].words.filter((w) => nodes[j].words.includes(w))
        if (sharedTags.length > 0 || sharedWords.length > 6) {
          edges.push({ from: nodes[i], to: nodes[j] })
        }
      }
    }

    return { nodes, edges }
  }, [notes])

  const projectOverview = useMemo(() => buildProjectOverview(activeProject), [activeProject])

  const activeModuleId = useMemo(() => {
    if (!activeProject) return ''
    const choice =
      activeProject.selectedModuleId && activeProject.selectedModuleId !== 'all'
        ? activeProject.selectedModuleId
        : activeProject.defaultModuleId
    return choice || ''
  }, [activeProject])

  const activeModuleLabel = useMemo(() => {
    if (!activeProject) return '—'
    if (!activeModuleId) return '—'
    const mod = (activeProject.modules || []).find((m) => m.id === activeModuleId)
    return mod?.name || '—'
  }, [activeProject, activeModuleId])

  const aiProviderLabel = useMemo(() => {
    const provider = activeProject?.ai?.provider || 'local'
    if (provider === 'openai') return 'OpenAI Codex'
    if (provider === 'ollama') return 'Local (Ollama)'
    if (provider === 'builtin') return 'Local (Built-in)'
    return 'Local bot'
  }, [activeProject])

  function renderActivityStream(withActions) {
    if (!activeProject) {
      return <p className="muted">Select a project to see activity.</p>
    }
    return (
      <div className="stream">
        {activityStream.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          activityStream.map((item) => (
            <div key={item.id} className={`stream-item ${item.kind}`}>
              <div className="stream-left">
                <span className="stream-badge">{item.label}</span>
                <div className="stream-text">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
              <div className="stream-right">
                <span className="muted">{formatRelativeTime(item.createdAt)}</span>
                {withActions && (
                  <>
                    {item.kind === 'join_request' && (
                      <div className="buttons">
                        <select
                          className="role-select"
                          value={item.req?.role || 'viewer'}
                          onChange={(e) => {
                            const role = e.target.value
                            setProjects((prev) =>
                              prev.map((p) =>
                                p.id === activeProject.id
                                  ? {
                                      ...p,
                                      joinRequests: (p.joinRequests || []).map((r) =>
                                        r.id === item.req.id ? { ...r, role } : r
                                      )
                                    }
                                  : p
                              )
                            )
                          }}
                          disabled={!canManage}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="suggester">Suggester</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          className="primary small"
                          onClick={() => handleAcceptRequest(item.req.id)}
                          disabled={!canManage}
                        >
                          Accept
                        </button>
                        <button
                          className="ghost small"
                          onClick={() => handleRejectRequest(item.req.id)}
                          disabled={!canManage}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {item.kind === 'suggestion' && (
                      <div className="buttons">
                        <button
                          className="ghost small"
                          onClick={() => rejectSuggestion(item.suggestion.id)}
                          disabled={!canManage}
                        >
                          Reject
                        </button>
                        <button
                          className="primary small"
                          onClick={() => approveSuggestion(item.suggestion.id)}
                          disabled={!canManage}
                        >
                          Apply
                        </button>
                      </div>
                    )}
                    {item.kind === 'conflict' && (
                      <div className="buttons">
                        <button
                          className="ghost small"
                          onClick={() => resolveConflict(item.conflict.id, 'local')}
                          disabled={!canManage}
                        >
                          Keep local
                        </button>
                        <button
                          className="ghost small"
                          onClick={() => resolveConflict(item.conflict.id, 'incoming')}
                          disabled={!canManage}
                        >
                          Use incoming
                        </button>
                        <button
                          className="primary small"
                          onClick={() => resolveConflictWithAI(item.conflict.id)}
                          disabled={!canManage}
                        >
                          AI merge
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    )
  }

  const activityStream = useMemo(() => {
    const items = []
    const project = activeProject
    if (!project) return items

    for (const msg of project.chat || []) {
      items.push({
        id: `chat:${msg.id}`,
        kind: 'chat',
        createdAt: msg.createdAt,
        label: 'Chat',
        title: msg.author,
        detail: msg.message
      })
    }

    for (const req of project.joinRequests || []) {
      items.push({
        id: `join:${req.id}`,
        kind: 'join_request',
        createdAt: req.createdAt,
        label: 'Join',
        title: req.name,
        detail: `Requests access · code ${req.code}`,
        req
      })
    }

    for (const s of project.suggestions || []) {
      items.push({
        id: `sug:${s.id}`,
        kind: 'suggestion',
        createdAt: s.createdAt,
        label: 'Suggest',
        title: s.fromName,
        detail: s.kind === 'file' ? `File suggestion: ${s.filePath}` : 'Project suggestion',
        suggestion: s
      })
    }

    for (const c of project.conflicts || []) {
      items.push({
        id: `conf:${c.id}`,
        kind: 'conflict',
        createdAt: c.createdAt,
        label: 'Conflict',
        title: c.kind === 'file' ? c.filePath : c.local?.title || 'Memory',
        detail: c.kind === 'file' ? 'File edits conflicted.' : 'Memory edits conflicted.',
        conflict: c
      })
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return items.slice(0, 80)
  }, [activeProject])

  const aiInstances = useMemo(() => {
    return [
      {
        id: 'overview',
        name: 'Project Overview',
        role: 'Maintains a living summary of how the project works.',
        status: 'active'
      },
      {
        id: 'context',
        name: 'Context Retriever',
        role: 'Finds the most relevant memories for tasks.',
        status: 'active'
      },
      {
        id: 'planner',
        name: 'Change Planner',
        role: 'Drafts file edits and tracks change requests.',
        status: 'queued'
      }
    ]
  }, [])

  const isSolo = collabRole === 'idle' || collabRole === 'offline'
  const isHostLike = isSolo || collabRole === 'host'

  const canEdit =
    isSolo ||
    collabRole === 'host' ||
    localRole === 'editor' ||
    localRole === 'admin' ||
    localRole === 'suggester'

  const canManage =
    isSolo || collabRole === 'host' || localRole === 'admin'

  const canViewFiles = isSolo || collabRole === 'host' || collabRole === 'client'

  const moduleOptions = useMemo(() => {
    const modules = activeProject?.modules || []
    const byParent = new Map()
    for (const mod of modules) {
      const parent = mod.parentId || null
      if (!byParent.has(parent)) byParent.set(parent, [])
      byParent.get(parent).push(mod)
    }
    for (const mods of byParent.values()) {
      mods.sort((a, b) => a.name.localeCompare(b.name))
    }
    const out = []
    const walk = (parentId, depth) => {
      const kids = byParent.get(parentId || null) || []
      for (const kid of kids) {
        out.push({ id: kid.id, label: `${'— '.repeat(depth)}${kid.name}`, depth })
        walk(kid.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [activeProject?.modules])

  function openNewModuleModal() {
    if (!activeProject) return
    setNewModuleName('')
    setNewModuleParentId(activeProject.selectedModuleId && activeProject.selectedModuleId !== 'all'
      ? activeProject.selectedModuleId
      : activeProject.defaultModuleId)
    setNewModuleOpen(true)
  }

  function commitCreateModule() {
    if (!activeProject) return
    if (!canManage) return
    const name = newModuleName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const parentId = newModuleParentId || activeProject.defaultModuleId
    const next = {
      ...activeProject,
      modules: [
        ...(activeProject.modules || []),
        { id: crypto.randomUUID(), name, parentId: parentId || null, createdAt: now, updatedAt: now }
      ],
      updatedAt: now
    }
    updateProject(next)
    setNewModuleOpen(false)
  }

  function resolveConflict(conflictId, action) {
    if (!activeProject) return
    const conflict = (activeProject.conflicts || []).find((c) => c.id === conflictId)
    if (!conflict) return

    let updatedNotes = activeProject.notes || []
    let updatedFiles = activeProject.fileMap || []

    if (conflict.kind === 'note') {
      if (action === 'incoming') {
        updatedNotes = updatedNotes.map((note) =>
          note.id === conflict.noteId ? conflict.incoming : note
        )
      }
    }

    if (conflict.kind === 'file') {
      if (action === 'incoming') {
        updatedFiles = updatedFiles.map((file) =>
          file.path === conflict.filePath ? conflict.incoming : file
        )
      }
    }

    const updatedProject = {
      ...activeProject,
      notes: updatedNotes,
      fileMap: updatedFiles,
      conflicts: (activeProject.conflicts || []).filter((c) => c.id !== conflictId),
      updatedAt: new Date().toISOString()
    }
    updateProject(updatedProject)
  }

  async function resolveConflictWithAI(conflictId) {
    if (!activeProject) return
    if (!canManage) return
    const conflict = (activeProject.conflicts || []).find((c) => c.id === conflictId)
    if (!conflict) return

    const provider = activeProject.ai?.provider || 'local'
    if (provider !== 'openai') {
      resolveConflict(conflictId, 'incoming') // no-op fallback isn't ideal; use heuristic suggestion below
      // Apply heuristic suggestion for local mode.
      if (conflict.kind === 'note') {
        const updatedNotes = (activeProject.notes || []).map((note) =>
          note.id === conflict.noteId ? conflict.suggested : note
        )
        updateProject({
          ...activeProject,
          notes: updatedNotes,
          conflicts: (activeProject.conflicts || []).filter((c) => c.id !== conflictId),
          updatedAt: new Date().toISOString()
        })
      }
      if (conflict.kind === 'file') {
        const updatedFiles = (activeProject.fileMap || []).map((file) =>
          file.path === conflict.filePath ? conflict.suggested : file
        )
        updateProject({
          ...activeProject,
          fileMap: updatedFiles,
          conflicts: (activeProject.conflicts || []).filter((c) => c.id !== conflictId),
          updatedAt: new Date().toISOString()
        })
      }
      return
    }

    setAiStatus('Asking Codex to merge…')
    try {
      if (conflict.kind === 'note') {
        const merged = await callOpenAIJSON({
          model: activeProject.ai?.model || 'gpt-5-codex',
          instructions:
            'You merge two edits of the same project memory. Return ONLY JSON with keys: title, body, tags (array of strings). Keep it concise and preserve intent from both.',
          input: JSON.stringify({
            local: conflict.local,
            incoming: conflict.incoming
          })
        })
        if (!merged?.title || !merged?.body || !Array.isArray(merged.tags)) {
          setAiStatus('AI merge failed; using local draft.')
          return
        }
        const updatedNotes = (activeProject.notes || []).map((note) =>
          note.id === conflict.noteId
            ? {
                ...note,
                title: merged.title,
                body: merged.body,
                tags: merged.tags,
                updatedAt: new Date().toISOString()
              }
            : note
        )
        updateProject({
          ...activeProject,
          notes: updatedNotes,
          conflicts: (activeProject.conflicts || []).filter((c) => c.id !== conflictId),
          updatedAt: new Date().toISOString()
        })
        setAiStatus('AI merge applied.')
        return
      }

      if (conflict.kind === 'file') {
        const merged = await callOpenAIJSON({
          model: activeProject.ai?.model || 'gpt-5-codex',
          instructions:
            'You merge two summaries for the same source file. Return ONLY JSON with key: summary. Keep it 1-2 sentences.',
          input: JSON.stringify({
            path: conflict.filePath,
            local: conflict.local,
            incoming: conflict.incoming
          })
        })
        if (!merged?.summary) {
          setAiStatus('AI merge failed; using local draft.')
          return
        }
        const updatedFiles = (activeProject.fileMap || []).map((file) =>
          file.path === conflict.filePath
            ? { ...file, summary: merged.summary, updatedAt: new Date().toISOString() }
            : file
        )
        updateProject({
          ...activeProject,
          fileMap: updatedFiles,
          conflicts: (activeProject.conflicts || []).filter((c) => c.id !== conflictId),
          updatedAt: new Date().toISOString()
        })
        setAiStatus('AI merge applied.')
      }
    } finally {
      setTimeout(() => setAiStatus(''), 1500)
    }
  }

  return (
    <div className={workbenchCollapsed ? 'app-shell workbench-collapsed' : 'app-shell workbench-open'}>
      <header className="top-bar">
        <div>
          <p className="eyebrow">Codex Creator Challenge</p>
          <h1>Project Brain</h1>
          <p className="subhead">
            A memory-first project manager that keeps your context alive across conversations.
          </p>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => setHelpOpen(true)}>?</button>
          <button
            className="ghost"
            onClick={() => {
              setSetupOpen(true)
              setSetupStep(0)
              setSetupMode('host')
              setSetupName(account?.name || '')
              setSetupHandle(account?.handle || '')
            }}
          >
            Setup
          </button>
          <button className="ghost" onClick={() => setAiOnlyMode((v) => !v)}>
            {aiOnlyMode ? 'Pro Mode' : 'AI-only Mode'}
          </button>
          <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
          <button className="ghost" onClick={handleCreateProject} disabled={!canManage}>New Project</button>
          <div className="chip">{notes.length} memories</div>
        </div>
      </header>

      <div className="menu-bar">
        <details className="menu">
          <summary>Projects</summary>
          <div className="menu-panel">
            <div className="menu-section">
              <p className="muted">Your projects</p>
              <div className="project-list">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={project.id === activeProject?.id ? 'project-item active' : 'project-item'}
                    onClick={() => {
                      setSelectedProjectId(project.id)
                      setSelectedNoteId(project.notes?.[0]?.id ?? null)
                    }}
                  >
                    <strong>{project.name}</strong>
                    <span>{project.notes?.length || 0} memories</span>
                  </button>
                ))}
              </div>
              <div className="buttons">
                <button className="ghost" onClick={handleCreateProject} disabled={!canManage}>New Project</button>
                <button className="ghost" onClick={handleExportData}>Export</button>
                <button className="ghost" onClick={handleImportData}>Import</button>
              </div>
            </div>

            <div className="menu-section">
              <p className="muted">Account</p>
              {account ? (
                <div className="account-card">
                  <strong>{account.name}</strong>
                  <span>@{account.handle}</span>
                  <div className="status-row">
                    <span className="status">Ready for secure sync</span>
                    <button className="ghost small">2FA</button>
                  </div>
                </div>
              ) : (
                <form className="account-card" onSubmit={handleCreateAccount}>
                  <input name="displayName" placeholder="Full name" />
                  <input name="handle" placeholder="Username" />
                  <button className="primary small" type="submit">Create account</button>
                  <p className="muted">Only required setup step.</p>
                </form>
              )}
            </div>
          </div>
        </details>

        <details className="menu">
          <summary>AI</summary>
          <div className="menu-panel">
            {!activeProject ? (
              <p className="muted">Select a project to configure its AI.</p>
            ) : (
              <div className="menu-section">
                <p className="muted">Project AI</p>
                <div className="invite-card">
                  <select
                    className="role-select"
                    value={activeProject?.ai?.provider || 'local'}
                    disabled={!canManage}
                    onChange={(e) => {
                      const provider = e.target.value
                      updateProject({
                        ...activeProject,
                        ai: { ...(activeProject.ai || {}), provider }
                      })
                    }}
                  >
                    <option value="local">Local bot (heuristic)</option>
                    <option value="builtin">Local LLM (Built-in)</option>
                    <option value="ollama">Local LLM (Ollama)</option>
                    <option value="openai">OpenAI Codex</option>
                  </select>

                  {activeProject?.ai?.provider === 'builtin' ? (
                    <>
                      <span className="muted">Choose a GGUF model to run locally (download is manual).</span>
                      <select
                        className="role-select"
                        value={activeProject?.ai?.builtinModelFile || ''}
                        onChange={(e) =>
                          updateProject({
                            ...activeProject,
                            ai: { ...(activeProject.ai || {}), builtinModelFile: e.target.value }
                          })
                        }
                      >
                        <option value="">Select downloaded model…</option>
                        {builtinModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        value={activeProject?.ai?.builtinModelUrl || ''}
                        onChange={(e) =>
                          updateProject({
                            ...activeProject,
                            ai: { ...(activeProject.ai || {}), builtinModelUrl: e.target.value }
                          })
                        }
                        placeholder="Model URL (GGUF) to download"
                      />
                      <input
                        value={activeProject?.ai?.builtinModelFile || ''}
                        onChange={(e) =>
                          updateProject({
                            ...activeProject,
                            ai: { ...(activeProject.ai || {}), builtinModelFile: e.target.value }
                          })
                        }
                        placeholder="Save as filename (e.g. model.gguf)"
                      />
                      <div className="buttons">
                        <button
                          className="ghost small"
                          onClick={async () => {
                            setAiStatus('Setting up runtime…')
                            const res = await window.projectBrain?.builtinEnsureRuntime?.({ download: true })
                            setAiStatus(res?.detail || '')
                          }}
                        >
                          Install runtime
                        </button>
                        <button
                          className="primary small"
                          onClick={async () => {
                            const url = activeProject?.ai?.builtinModelUrl
                            const fileName = activeProject?.ai?.builtinModelFile
                            if (!url || !fileName) {
                              setAiStatus('Enter a model URL and a filename first.')
                              return
                            }
                            setAiStatus('Downloading model…')
                            const res = await window.projectBrain?.builtinDownloadModel?.({ url, fileName })
                            const list = await window.projectBrain?.builtinListModels?.()
                            if (list?.ok) setBuiltinModels(list.models || [])
                            setAiStatus(res?.detail || '')
                          }}
                        >
                          Download model
                        </button>
                        <button
                          className="ghost small"
                          onClick={async () => {
                            const fileName = activeProject?.ai?.builtinModelFile
                            if (!fileName) {
                              setAiStatus('Select a model file first.')
                              return
                            }
                            setAiStatus('Starting local server…')
                            const runtime = await window.projectBrain?.builtinEnsureRuntime?.({ download: false })
                            if (!runtime?.ok) {
                              setAiStatus(runtime?.detail || 'Install runtime first.')
                              return
                            }
                            const res = await window.projectBrain?.builtinStartServer?.({ modelFile: fileName, port: 8081 })
                            setAiStatus(res?.detail || '')
                          }}
                        >
                          Start model
                        </button>
                      </div>
                      {aiStatus && <span className="muted">{aiStatus}</span>}
                    </>
                  ) : activeProject?.ai?.provider === 'ollama' ? (
                    <>
                      <span className="muted">Ollama runs models locally (download is manual).</span>
                      <input
                        value={activeProject?.ai?.localModel || 'qwen2.5-coder:7b'}
                        onChange={(e) =>
                          updateProject({
                            ...activeProject,
                            ai: { ...(activeProject.ai || {}), localModel: e.target.value }
                          })
                        }
                        placeholder="Ollama model (e.g. qwen2.5-coder:7b)"
                      />
                      <div className="buttons">
                        <button
                          className="ghost small"
                          onClick={async () => {
                            setAiStatus('Starting Ollama…')
                            const res = await window.projectBrain?.ollamaEnsureRunning?.()
                            setAiStatus(res?.detail || '')
                          }}
                        >
                          Start Ollama
                        </button>
                        <button
                          className="primary small"
                          onClick={async () => {
                            setAiStatus('Downloading model…')
                            await window.projectBrain?.ollamaEnsureRunning?.()
                            const res = await window.projectBrain?.ollamaPull?.({
                              model: activeProject?.ai?.localModel || 'qwen2.5-coder:7b'
                            })
                            setAiStatus(res?.detail || '')
                          }}
                        >
                          Download model
                        </button>
                      </div>
                      {aiStatus && <span className="muted">{aiStatus}</span>}
                    </>
                  ) : activeProject?.ai?.provider === 'openai' ? (
                    <>
                      <span className="muted">Key status: {openAIKeyPresent ? 'Connected' : 'Not connected'}</span>
                      {!openAIKeyPresent ? (
                        <form onSubmit={handleSaveOpenAIKey} className="buttons">
                          <input
                            value={openAIKeyInput}
                            onChange={(e) => setOpenAIKeyInput(e.target.value)}
                            placeholder="OpenAI API key"
                          />
                          <button className="primary small" type="submit">
                            Save key
                          </button>
                        </form>
                      ) : (
                        <button className="ghost small" onClick={handleClearOpenAIKey}>
                          Clear key
                        </button>
                      )}
                      {aiStatus && <span className="muted">{aiStatus}</span>}
                    </>
                  ) : (
                    <span className="muted">Local bot is built-in (no account or key required).</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </details>

        <details className="menu">
          <summary>Collaborate</summary>
          <div className="menu-panel wide">
            <div className="menu-grid">
              <div className="invite-card">
                <p className="muted">Invite code</p>
                <div className="code">{activeProject?.inviteCode || 'JOIN-0000'}</div>
                <div className="buttons">
                  <button
                    className="ghost small"
                    onClick={async () => {
                      const ok = await copyToClipboard(activeProject?.inviteCode || '')
                      if (ok) setAiStatus('Invite code copied.')
                    }}
                  >
                    Copy code
                  </button>
                  <button
                    className="ghost small"
                    onClick={() =>
                      updateProject({
                        ...activeProject,
                        inviteCode: `JOIN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
                      })
                    }
                    disabled={!canManage}
                  >
                    Rotate
                  </button>
                </div>
              </div>

              <div className="invite-card">
                <p className="muted">Connection</p>
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="Signaling server URL"
                />
                <div className="status-row">
                  <span className={`status ${collabStatus}`}>
                    {collabStatus === 'secure'
                      ? `Secure · ${peers.length} peer${peers.length === 1 ? '' : 's'}`
                      : `Status: ${collabStatus}`}
                  </span>
                  <button className="primary small" onClick={startHostSession}>Host</button>
                </div>
                <div className="buttons">
                  <button
                    className="ghost small"
                    onClick={async () => {
                      const res = await window.projectBrain?.signalStartLocal?.()
                      if (res?.ok) {
                        const preferred = (res.lanUrls && res.lanUrls[0]) || (res.urls && res.urls[0])
                        if (preferred) setServerUrl(preferred)
                        setAiStatus('Local server started (LAN).')
                        setTimeout(() => setAiStatus(''), 1800)
                      } else {
                        setAiStatus(res?.detail || 'Unable to start local signaling server.')
                        setTimeout(() => setAiStatus(''), 2200)
                      }
                    }}
                  >
                    Start LAN server
                  </button>
                  <button className="ghost small" onClick={disconnectCollab} disabled={collabRole === 'idle'}>
                    Disconnect
                  </button>
                </div>

                <details className="direct-connect">
                  <summary className="block-summary">
                    <strong>Direct Connect</strong>
                    <span className="muted">No server</span>
                  </summary>
                  <div className="buttons">
                    <button className="ghost small" onClick={directHostGenerateOffer} disabled={!activeProject?.inviteCode}>
                      Generate Offer (Host)
                    </button>
                  </div>
                  {directOfferOut && (
                    <label>
                      Offer code
                      <textarea className="overview" value={directOfferOut} readOnly />
                    </label>
                  )}
                  <label>
                    Paste offer (Joiner)
                    <textarea className="overview" value={directOfferIn} onChange={(e) => setDirectOfferIn(e.target.value)} />
                  </label>
                  <div className="buttons">
                    <button className="ghost small" onClick={directJoinGenerateAnswer} disabled={!directOfferIn.trim()}>
                      Generate Answer (Joiner)
                    </button>
                  </div>
                  {directAnswerOut && (
                    <label>
                      Answer code
                      <textarea className="overview" value={directAnswerOut} readOnly />
                    </label>
                  )}
                  <label>
                    Paste answer (Host)
                    <textarea className="overview" value={directAnswerIn} onChange={(e) => setDirectAnswerIn(e.target.value)} />
                  </label>
                  <div className="buttons">
                    <button className="primary small" onClick={directHostAcceptAnswer} disabled={!directAnswerIn.trim()}>
                      Accept Answer (Host)
                    </button>
                  </div>
                </details>
              </div>

              <div className="invite-card">
                <p className="muted">Connected peers</p>
                {peers.length === 0 ? (
                  <p className="muted">No peers connected.</p>
                ) : (
                  <ul className="peer-list">
                    {peers.map((peer) => (
                      <li key={peer.id}>
                        <div className="peer-meta">
                          <strong>{peer.name}</strong>
                          {canManage ? (
                            <select
                              className="role-select"
                              value={(activeProject?.collaborators || []).find((c) => c.peerId === peer.id)?.role || 'viewer'}
                              onChange={(e) => setCollaboratorRole(peer.id, e.target.value)}
                            >
                              <option value="viewer">viewer</option>
                              <option value="suggester">suggester</option>
                              <option value="editor">editor</option>
                              <option value="admin">admin</option>
                            </select>
                          ) : (
                            <span>
                              {(activeProject?.collaborators || []).find((c) => c.peerId === peer.id)?.role || 'viewer'}
                            </span>
                          )}
                        </div>
                        <div className="peer-actions">
                          <span>{peer.id.slice(0, 6)}</span>
                          {canManage && (
                            <button className="ghost small" onClick={() => removeCollaborator(peer.id)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="invite-card">
                <p className="muted">Join a host</p>
                <form onSubmit={handleJoinRequest}>
                  <input
                    placeholder="Invite code"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value)}
                  />
                  <input
                    placeholder="Your name"
                    value={inviteNameInput}
                    onChange={(e) => setInviteNameInput(e.target.value)}
                  />
                  <button className="primary small" type="submit">Request access</button>
                </form>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div className="now-strip" role="status" aria-label="Current project status">
        <div className="now-left">
          <span className="now-chip">
            <span className="muted">Project</span>
            <strong>{activeProject?.name || '—'}</strong>
          </span>
          <span className="now-chip">
            <span className="muted">Module</span>
            <strong>{activeModuleLabel}</strong>
          </span>
          <span className="now-chip">
            <span className="muted">AI</span>
            <strong>{aiProviderLabel}</strong>
          </span>
          <span className={`now-chip status ${collabStatus}`}>
            <span className="muted">Sync</span>
            <strong>
              {isSolo ? 'Local' : collabRole === 'host' ? `Host · ${collabStatus}` : `Client · ${collabStatus}`}
            </strong>
          </span>
          <span className="now-chip">
            <span className="muted">Role</span>
            <strong>{isSolo ? 'Owner' : collabRole === 'host' ? 'Host' : localRole}</strong>
          </span>
        </div>
        <div className="now-right">
          {activeProject && !activeProject.projectRoot && (
            <button className="primary small" onClick={handleSelectProjectRoot} disabled={!canManage}>
              Set Project Root
            </button>
          )}
        </div>
      </div>

      <div className="content content-single">
        <aside className="sidebar">
          <div className="section">
            <p className="muted">Your Projects</p>
            <div className="project-list">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={project.id === activeProject?.id ? 'project-item active' : 'project-item'}
                  onClick={() => {
                    setSelectedProjectId(project.id)
                    setSelectedNoteId(project.notes?.[0]?.id ?? null)
                  }}
                >
                  <strong>{project.name}</strong>
                  <span>{project.notes?.length || 0} memories</span>
                </button>
              ))}
            </div>
          </div>

          <div className="section">
            <p className="muted">Account</p>
            {account ? (
              <div className="account-card">
                <strong>{account.name}</strong>
                <span>@{account.handle}</span>
                <div className="status-row">
                  <span className="status">Ready for secure sync</span>
                  <button className="ghost small">2FA</button>
                </div>
                <div className="buttons">
                  <button className="ghost small" onClick={handleExportData}>Export</button>
                  <button className="ghost small" onClick={handleImportData}>Import</button>
                </div>
              </div>
            ) : (
              <form className="account-card" onSubmit={handleCreateAccount}>
                <input name="displayName" placeholder="Full name" />
                <input name="handle" placeholder="Username" />
                <button className="primary small" type="submit">Create account</button>
                <p className="muted">Only required setup step.</p>
              </form>
            )}
          </div>

          <div className="section">
            <p className="muted">Project AI</p>
            <div className="invite-card">
              <select
                className="role-select"
                value={activeProject?.ai?.provider || 'local'}
                disabled={!canManage}
                onChange={(e) => {
                  const provider = e.target.value
                  updateProject({
                    ...activeProject,
                    ai: { ...(activeProject.ai || {}), provider }
                  })
                }}
              >
                <option value="local">Local bot (heuristic)</option>
                <option value="builtin">Local LLM (Built-in)</option>
                <option value="ollama">Local LLM (Ollama)</option>
                <option value="openai">OpenAI Codex</option>
              </select>

              {activeProject?.ai?.provider === 'builtin' ? (
                <>
                  <span className="muted">Choose a GGUF model to download (only downloads when you click).</span>
                  <select
                    className="role-select"
                    value={activeProject?.ai?.builtinModelFile || ''}
                    onChange={(e) =>
                      updateProject({
                        ...activeProject,
                        ai: { ...(activeProject.ai || {}), builtinModelFile: e.target.value }
                      })
                    }
                  >
                    <option value="">Select downloaded model…</option>
                    {builtinModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    value={activeProject?.ai?.builtinModelUrl || ''}
                    onChange={(e) =>
                      updateProject({
                        ...activeProject,
                        ai: { ...(activeProject.ai || {}), builtinModelUrl: e.target.value }
                      })
                    }
                    placeholder="Model URL (GGUF) to download"
                  />
                  <input
                    value={activeProject?.ai?.builtinModelFile || ''}
                    onChange={(e) =>
                      updateProject({
                        ...activeProject,
                        ai: { ...(activeProject.ai || {}), builtinModelFile: e.target.value }
                      })
                    }
                    placeholder="Save as filename (e.g. model.gguf)"
                  />
                  <div className="buttons">
                    <button
                      className="ghost small"
                      onClick={async () => {
                        setAiStatus('Setting up runtime…')
                        const res = await window.projectBrain?.builtinEnsureRuntime?.({ download: true })
                        setAiStatus(res?.detail || '')
                      }}
                    >
                      Install runtime
                    </button>
                    <button
                      className="primary small"
                      onClick={async () => {
                        const url = activeProject?.ai?.builtinModelUrl
                        const fileName = activeProject?.ai?.builtinModelFile
                        if (!url || !fileName) {
                          setAiStatus('Enter a model URL and a filename first.')
                          return
                        }
                        setAiStatus('Downloading model…')
                        const res = await window.projectBrain?.builtinDownloadModel?.({ url, fileName })
                        const list = await window.projectBrain?.builtinListModels?.()
                        if (list?.ok) setBuiltinModels(list.models || [])
                        setAiStatus(res?.detail || '')
                      }}
                    >
                      Download model
                    </button>
                    <button
                      className="ghost small"
                      onClick={async () => {
                        const fileName = activeProject?.ai?.builtinModelFile
                        if (!fileName) {
                          setAiStatus('Select a model file first.')
                          return
                        }
                        setAiStatus('Starting local server…')
                        const runtime = await window.projectBrain?.builtinEnsureRuntime?.({ download: false })
                        if (!runtime?.ok) {
                          setAiStatus(runtime?.detail || 'Install runtime first.')
                          return
                        }
                        const res = await window.projectBrain?.builtinStartServer?.({ modelFile: fileName, port: 8081 })
                        setAiStatus(res?.detail || '')
                      }}
                    >
                      Start model
                    </button>
                  </div>
                  {aiStatus && <span className="muted">{aiStatus}</span>}
                  <span className="muted">
                    This runs fully offline once downloaded. Swap models by selecting a different GGUF file.
                  </span>
                </>
              ) : activeProject?.ai?.provider === 'ollama' ? (
                <>
                  <span className="muted">Select a local model to download and run.</span>
                  <input
                    value={activeProject?.ai?.localModel || 'qwen2.5-coder:7b'}
                    onChange={(e) =>
                      updateProject({
                        ...activeProject,
                        ai: { ...(activeProject.ai || {}), localModel: e.target.value }
                      })
                    }
                    placeholder="Ollama model (e.g. qwen2.5-coder:7b)"
                  />
                  <div className="buttons">
                    <button
                      className="ghost small"
                      onClick={async () => {
                        setAiStatus('Starting Ollama…')
                        const res = await window.projectBrain?.ollamaEnsureRunning?.()
                        setAiStatus(res?.detail || '')
                      }}
                    >
                      Start Ollama
                    </button>
                    <button
                      className="primary small"
                      onClick={async () => {
                        setAiStatus('Downloading model…')
                        await window.projectBrain?.ollamaEnsureRunning?.()
                        const res = await window.projectBrain?.ollamaPull?.({
                          model: activeProject?.ai?.localModel || 'qwen2.5-coder:7b'
                        })
                        setAiStatus(res?.detail || '')
                      }}
                    >
                      Download Model
                    </button>
                  </div>
                  {aiStatus && <span className="muted">{aiStatus}</span>}
                  <span className="muted">
                    Tip: good models: <code>qwen2.5-coder:7b</code>, <code>llama3.2:3b</code>.
                  </span>
                </>
              ) : activeProject?.ai?.provider === 'openai' ? (
                <>
                  <span className="muted">
                    Key status: {openAIKeyPresent ? 'Connected' : 'Not connected'}
                  </span>
                  {!openAIKeyPresent ? (
                    <form onSubmit={handleSaveOpenAIKey} className="buttons">
                      <input
                        value={openAIKeyInput}
                        onChange={(e) => setOpenAIKeyInput(e.target.value)}
                        placeholder="OpenAI API key"
                      />
                      <button className="primary small" type="submit">Save key</button>
                    </form>
                  ) : (
                    <button className="ghost small" onClick={handleClearOpenAIKey}>Clear key</button>
                  )}
                  {aiStatus && <span className="muted">{aiStatus}</span>}
                </>
              ) : (
                <span className="muted">Local bot is built-in (no account or key required).</span>
              )}
            </div>
          </div>

          <div className="section">
            <p className="muted">Invite-only Access</p>
            <div className="invite-card">
              <div className="code">{activeProject?.inviteCode || 'JOIN-0000'}</div>
              <span>Share this code with teammates.</span>
              <div className="buttons">
                <button
                  className="ghost small"
                  onClick={async () => {
                    const ok = await copyToClipboard(activeProject?.inviteCode || '')
                    if (ok) setAiStatus('Invite code copied.')
                  }}
                >
                  Copy code
                </button>
                <button
                  className="ghost small"
                  onClick={() =>
                    updateProject({
                      ...activeProject,
                      inviteCode: `JOIN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
                    })
                  }
                  disabled={!canManage}
                >
                  Rotate code
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <p className="muted">Collaboration</p>
            <div className="invite-card">
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="Signaling server URL"
              />
              <div className="status-row">
                <span className={`status ${collabStatus}`}>
                  {collabStatus === 'secure'
                    ? `Secure · ${peers.length} peer${peers.length === 1 ? '' : 's'}`
                    : `Status: ${collabStatus}`}
                </span>
                <button className="primary small" onClick={startHostSession}>Host project</button>
              </div>
              <div className="buttons">
                <button
                  className="ghost small"
                  onClick={async () => {
                    const res = await window.projectBrain?.signalStartLocal?.()
                    if (res?.ok) {
                      const preferred = (res.lanUrls && res.lanUrls[0]) || (res.urls && res.urls[0])
                      if (preferred) setServerUrl(preferred)
                      setAiStatus('Local signaling server started (LAN).')
                      setTimeout(() => setAiStatus(''), 1800)
                    } else {
                      setAiStatus(res?.detail || 'Unable to start local signaling server.')
                      setTimeout(() => setAiStatus(''), 2200)
                    }
                  }}
                >
                  Start Local Server
                </button>
                <button
                  className="ghost small"
                  onClick={async () => {
                    const ok = await copyToClipboard(serverUrl)
                    if (ok) setAiStatus('Server URL copied.')
                  }}
                >
                  Copy URL
                </button>
                <button
                  className="ghost small"
                  onClick={disconnectCollab}
                  disabled={collabRole === 'idle'}
                >
                  Disconnect
                </button>
              </div>
              <p className="muted">Direct P2P sync with end-to-end encryption (structure ready).</p>

              <details className="direct-connect">
                <summary className="block-summary">
                  <strong>Host Options</strong>
                  <span className="muted">Direct connect</span>
                </summary>
                <p className="muted">
                  No server? Use Direct Connect codes (works anywhere WebRTC can connect).
                </p>
                <div className="buttons">
                  <button className="ghost small" onClick={directHostGenerateOffer} disabled={!activeProject?.inviteCode}>
                    Generate Offer (Host)
                  </button>
                </div>
                {directOfferOut && (
                  <label>
                    Offer code (send to joiner)
                    <textarea className="overview" value={directOfferOut} readOnly />
                  </label>
                )}

                <label>
                  Paste offer code (Joiner)
                  <textarea className="overview" value={directOfferIn} onChange={(e) => setDirectOfferIn(e.target.value)} />
                </label>
                <div className="buttons">
                  <button className="ghost small" onClick={directJoinGenerateAnswer} disabled={!directOfferIn.trim()}>
                    Generate Answer (Joiner)
                  </button>
                </div>
                {directAnswerOut && (
                  <label>
                    Answer code (send back to host)
                    <textarea className="overview" value={directAnswerOut} readOnly />
                  </label>
                )}

                <label>
                  Paste answer code (Host)
                  <textarea className="overview" value={directAnswerIn} onChange={(e) => setDirectAnswerIn(e.target.value)} />
                </label>
                <div className="buttons">
                  <button className="primary small" onClick={directHostAcceptAnswer} disabled={!directAnswerIn.trim()}>
                    Accept Answer (Host)
                  </button>
                </div>
              </details>
            </div>
          </div>

          <div className="section">
            <p className="muted">Connected Peers</p>
            <div className="invite-card">
              {peers.length === 0 ? (
                <p className="muted">No peers connected.</p>
              ) : (
                <ul className="peer-list">
                  {peers.map((peer) => (
                    <li key={peer.id}>
                      <div className="peer-meta">
                        <strong>{peer.name}</strong>
                        {canManage ? (
                          <select
                            className="role-select"
                            value={(activeProject?.collaborators || []).find((c) => c.peerId === peer.id)?.role || 'viewer'}
                            onChange={(e) => setCollaboratorRole(peer.id, e.target.value)}
                          >
                            <option value="viewer">viewer</option>
                            <option value="suggester">suggester</option>
                            <option value="editor">editor</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <span>
                            {(activeProject?.collaborators || []).find((c) => c.peerId === peer.id)?.role || 'viewer'}
                          </span>
                        )}
                      </div>
                      <div className="peer-actions">
                        <span>{peer.id.slice(0, 6)}</span>
                        {canManage && (
                          <button
                            className="ghost small"
                            onClick={() => removeCollaborator(peer.id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="section">
            <p className="muted">Join Request</p>
            <form className="invite-card" onSubmit={handleJoinRequest}>
              <input
                placeholder="Invite code"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
              />
              <input
                placeholder="Your name"
                value={inviteNameInput}
                onChange={(e) => setInviteNameInput(e.target.value)}
              />
              <button className="primary small" type="submit">Request access</button>
              <p className="muted">
                Host can auto-start a local signaling server (LAN) when you click Host project. For internet-wide, deploy
                <code>signaling/worker.js</code> (Cloudflare Worker) and paste the resulting <code>wss://</code> URL.
              </p>
            </form>
          </div>
        </aside>

        <main className="main">
          {aiOnlyMode ? (
            <div className="grid">
              <section className="panel home span-all">
                <div className="panel-header">
                  <h2>Home</h2>
                  <div className="chip alt">Stream</div>
                </div>
                {renderActivityStream(true)}

                <details className="insight-block" open>
                  <summary className="block-summary">
                    <strong>Memory Connections</strong>
                    <span className="muted">Graph</span>
                  </summary>
                  <svg className="graph" viewBox="0 0 280 280" role="img" aria-label="Memory graph">
                    {graphData.edges.map((edge, idx) => (
                      <line
                        key={`edge-${idx}`}
                        x1={edge.from.x}
                        y1={edge.from.y}
                        x2={edge.to.x}
                        y2={edge.to.y}
                      />
                    ))}
                    {graphData.nodes.map((node) => (
                      <g key={node.id}>
                        <circle cx={node.x} cy={node.y} r={8} />
                        <text x={node.x + 12} y={node.y + 4}>
                          {node.label.slice(0, 12)}
                        </text>
                      </g>
                    ))}
                  </svg>
                </details>
              </section>
            </div>
          ) : (
            <div className="grid">
              <section className="panel home span-all">
                <div className="panel-header">
                  <h2>Home</h2>
                  <div className="chip alt">Stream</div>
                </div>
                {renderActivityStream(true)}

                <details className="insight-block" open>
                  <summary className="block-summary">
                    <strong>Memory Connections</strong>
                    <span className="muted">Graph</span>
                  </summary>
                  <svg className="graph" viewBox="0 0 280 280" role="img" aria-label="Memory graph">
                    {graphData.edges.map((edge, idx) => (
                      <line
                        key={`edge-${idx}`}
                        x1={edge.from.x}
                        y1={edge.from.y}
                        x2={edge.to.x}
                        y2={edge.to.y}
                      />
                    ))}
                    {graphData.nodes.map((node) => (
                      <g key={node.id}>
                        <circle cx={node.x} cy={node.y} r={8} />
                        <text x={node.x + 12} y={node.y + 4}>
                          {node.label.slice(0, 12)}
                        </text>
                      </g>
                    ))}
                  </svg>
                </details>
              </section>

              <section className="panel">
              <div className="panel-header">
                <h2>Memory Index</h2>
                <div className="filters">
                  <select
                    className="role-select"
                    value={activeProject?.selectedModuleId || activeProject?.defaultModuleId || ''}
                    onChange={(e) => {
                      const selectedModuleId = e.target.value
                      updateProject({ ...activeProject, selectedModuleId })
                    }}
                    disabled={!activeProject}
                  >
                    <option value="all">All modules</option>
                    {moduleOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button className="ghost small" onClick={openNewModuleModal} disabled={!canManage}>
                    New module
                  </button>
                  <button className="primary small" onClick={handleCreateNote} disabled={!canEdit}>
                    New memory
                  </button>
                  <input
                    type="search"
                    placeholder="Search memories..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Filter tag (e.g. launch)"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                  />
                </div>
              </div>

              <div className="list">
                {filteredNotes.length === 0 && (
                  <div className="empty">No memories match that query yet.</div>
                )}
                {filteredNotes.map((note) => (
                  <button
                    key={note.id}
                    className={note.id === selectedNoteId ? 'card selected' : 'card'}
                    onClick={() => setSelectedNoteId(note.id)}
                  >
                    <div>
                      <h3>
                        {note.title}
                        {note.isStub && <span className="chip stub">Condensed</span>}
                      </h3>
                      <p>{note.body.split('\n')[0]}</p>
                    </div>
                    <div className="meta">
                      <span>{formatDate(note.updatedAt)}</span>
                      <div className="tags">
                        {note.tags.slice(0, 6).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                        {note.tags.length > 6 && <span className="muted">+{note.tags.length - 6}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel editor">
              {selectedNote ? (
                <>
                  <div className="panel-header">
                    <h2>Memory Editor</h2>
                    <button className="ghost" onClick={() => handleDeleteNote(selectedNote.id)} disabled={!canEdit}>
                      Delete
                    </button>
                  </div>
                  {selectedNote.isStub && (
                    <div className="invite-card">
                      <p className="muted">
                        This memory was condensed into a lightweight stub to keep the web intact and the project fast.
                      </p>
                      <div className="buttons">
                        <button className="primary small" onClick={() => restoreStubNote(selectedNote.id)} disabled={!canEdit}>
                          Restore full
                        </button>
                        <button
                          className="ghost small"
                          onClick={() => {
                            const archived = findArchivedEntryForNote(selectedNote)
                            setArchivedMemory(archived)
                            setArchivedMemoryOpen(true)
                          }}
                        >
                          View archived
                        </button>
                      </div>
                    </div>
                  )}
                  <label>
                    Title
                    <input
                      value={selectedNote.title}
                      onChange={(e) => updateSelectedNote({ title: e.target.value })}
                      disabled={!canEdit}
                    />
                  </label>
                  <label>
                    Module
                    <select
                      className="role-select"
                      value={selectedNote.moduleId || activeProject?.defaultModuleId || ''}
                      onChange={(e) => updateSelectedNote({ moduleId: e.target.value })}
                      disabled={!canEdit}
                    >
                      {moduleOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label.replace(/^—\s*/, '')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tags (comma separated, e.g. launch, research)
                    <input
                      value={selectedNote.tags.join(', ')}
                      onChange={(e) =>
                        updateSelectedNote({
                          tags: e.target.value
                            ? parseTags(e.target.value)
                            : []
                        })
                      }
                      disabled={!canEdit}
                    />
                  </label>
                  <label>
                    Memory
                    <textarea
                      value={selectedNote.body}
                      onChange={(e) => updateSelectedNote({ body: e.target.value })}
                      disabled={!canEdit}
                      readOnly={Boolean(selectedNote.isStub)}
                    />
                  </label>
                  <div className="timestamps">
                    <span>Created: {formatDate(selectedNote.createdAt)}</span>
                    <span>Updated: {formatDate(selectedNote.updatedAt)}</span>
                  </div>
                </>
              ) : (
                <div className="empty">Create a memory to start building context.</div>
              )}
            </section>

            <section className="panel insights">
              <div className="panel-header">
                <h2>Context Pulse</h2>
                <div className="chip alt">Memory health</div>
              </div>
              <div className="stats">
                <div>
                  <h3>{memoryStats.count}</h3>
                  <p>Active memories</p>
                </div>
                <div>
                  <h3>{memoryStats.condensedCount}</h3>
                  <p>Condensed memories</p>
                </div>
                <div>
                  <h3>{memoryStats.lastUpdated ? formatDate(memoryStats.lastUpdated) : '—'}</h3>
                  <p>Last update</p>
                </div>
              </div>
              <p className="muted">Tip: the Home panel shows the live stream + spiderweb graph.</p>

              <details className="insight-block">
                <summary className="block-summary">
                  <strong>Collaboration Inbox</strong>
                  <span className="muted">{(activeProject?.joinRequests || []).length} pending</span>
                </summary>
                {(activeProject?.joinRequests || []).length === 0 ? (
                  <p className="muted">No pending requests.</p>
                ) : (
                  <div className="requests">
                    {activeProject.joinRequests.map((req) => (
                      <div key={req.id} className="request-item">
                        <div>
                          <strong>{req.name}</strong>
                          <span>{req.code}</span>
                        </div>
                        <div className="buttons">
                          <select
                            className="role-select"
                            value={req.role || 'viewer'}
                            onChange={(e) => {
                              const role = e.target.value
                              setProjects((prev) =>
                                prev.map((p) =>
                                  p.id === activeProject.id
                                    ? {
                                        ...p,
                                        joinRequests: p.joinRequests.map((r) =>
                                          r.id === req.id ? { ...r, role } : r
                                        )
                                      }
                                    : p
                                )
                              )
                            }}
                            disabled={!canManage}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="suggester">Suggester</option>
                            <option value="editor">Editor</option>
                            <option value="admin">Administrator</option>
                          </select>
                          <button className="ghost small" onClick={() => handleRejectRequest(req.id)} disabled={!canManage}>
                            Reject
                          </button>
                          <button className="primary small" onClick={() => handleAcceptRequest(req.id)} disabled={!canManage}>
                            Accept
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>

              <details className="insight-block">
                <summary className="block-summary">
                  <strong>Suggestions</strong>
                  <span className="muted">{(activeProject?.suggestions || []).length} pending</span>
                </summary>
                {(activeProject?.suggestions || []).length === 0 ? (
                  <p className="muted">No pending suggestions.</p>
                ) : (
                  <div className="requests">
                    {activeProject.suggestions.map((suggestion) => (
                      <div key={suggestion.id} className="request-item">
                        <div>
                          <strong>{suggestion.fromName}</strong>
                          <span>
                            {suggestion.kind === 'file'
                              ? `File update: ${suggestion.filePath}`
                              : 'Project update suggestion'}
                          </span>
                        </div>
                        <div className="buttons">
                          <button
                            className="ghost small"
                            onClick={() => rejectSuggestion(suggestion.id)}
                            disabled={!canManage}
                          >
                            Reject
                          </button>
                          <button
                            className="primary small"
                            onClick={() => approveSuggestion(suggestion.id)}
                            disabled={!canManage}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>

              <details className="insight-block">
                <summary className="block-summary">
                  <strong>Conflict Alerts</strong>
                  <span className="muted">{(activeProject?.conflicts || []).length} active</span>
                </summary>
                {(activeProject?.conflicts || []).length === 0 ? (
                  <p className="muted">No conflicts detected.</p>
                ) : (
                  <div className="requests">
                    {activeProject.conflicts.map((conflict) => (
                      <div key={conflict.id} className="request-item">
                        <div>
                          <strong>{conflict.kind === 'file' ? conflict.filePath : conflict.local.title}</strong>
                          <span>
                            {conflict.kind === 'file'
                              ? 'File edits conflicted.'
                              : 'Memory edits conflicted.'}
                          </span>
                        </div>
                        <div className="buttons">
                          <button
                            className="ghost small"
                            onClick={() => resolveConflict(conflict.id, 'local')}
                            disabled={!canManage}
                          >
                            Keep local
                          </button>
                          <button
                            className="ghost small"
                            onClick={() => resolveConflict(conflict.id, 'incoming')}
                            disabled={!canManage}
                          >
                            Use incoming
                          </button>
                          <button
                            className="primary small"
                            onClick={() => resolveConflictWithAI(conflict.id)}
                            disabled={!canManage}
                          >
                            AI merge draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>

              <div className="insight-block">
                <h4>Team Chat</h4>
                <div className="chat">
                  {(activeProject?.chat || []).map((msg) => (
                    <div key={msg.id} className="chat-line">
                      <strong>{msg.author}</strong>
                      <span>{msg.message}</span>
                    </div>
                  ))}
                </div>
                <form className="chat-input" onSubmit={handleSendChat}>
                  <input
                    placeholder="Message the team..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button className="primary small" type="submit">Send</button>
                </form>
              </div>

              <div className="insight-block">
                <h4>Retention</h4>
                <p>
                  Project Brain condenses memories older than {activeProject?.retention?.days ?? DEFAULT_RETENTION_DAYS} days
                  or beyond {activeProject?.retention?.maxActiveNotes ?? MAX_ACTIVE_NOTES} active notes.
                </p>
                <button className="ghost" onClick={handleCondense}>Condense old context</button>
              </div>

              <div className="insight-block">
                <h4>AI Instances</h4>
                <div className="instances">
                  {aiInstances.map((instance) => (
                    <div key={instance.id} className={`instance ${instance.status}`}>
                      <div>
                        <strong>{instance.name}</strong>
                        <p>{instance.role}</p>
                      </div>
                      <span className="state">{instance.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="insight-block">
                <h4>Living Project Overview</h4>
                <textarea className="overview" value={projectOverview} readOnly />
                <p className="muted">
                  This is the persistent, condensed context shared by collaborators and AI to avoid re-reading the entire repo.
                </p>
              </div>

              <div className="insight-block">
                <h4>AI Console</h4>
                <p className="muted">
                  Ask the project AI to explain, plan, or change files. (Host can apply edits directly to the project root.)
                </p>
                <div className="file-actions">
                  <select
                    className="role-select"
                    value={aiConsoleScope}
                    onChange={(e) => setAiConsoleScope(e.target.value)}
                  >
                    <option value="selected">Context: selected file</option>
                    <option value="all">Context: many files (capped)</option>
                  </select>
                  <div className="buttons">
                    <button
                      className="primary small"
                      onClick={runProjectAICommand}
                      disabled={aiConsoleBusy || !aiPrompt.trim()}
                    >
                      {aiConsoleBusy ? 'Running…' : 'Run AI'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="overview"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Update src/App.jsx to add a button that exports the file map as markdown."
                />
                {aiConsoleReply && (
                  <div className="ai-reply">
                    <strong>AI reply</strong>
                    <pre>{aiConsoleReply}</pre>
                  </div>
                )}
              </div>

              <div className="insight-block">
                <h4>File map</h4>
                <div className="file-actions">
                  <div className="file-root">
                    <span className="muted">Project root</span>
                    <strong>{activeProject?.projectRoot || 'Not set'}</strong>
                  </div>
                  <div className="buttons">
                    <button className="ghost" onClick={handleSelectProjectRoot} disabled={!canManage}>Set Root</button>
                    <button className="ghost" onClick={openNewFileModal} disabled={!canEdit}>
                      New File
                    </button>
                    <button className="ghost" onClick={handleScanProject} disabled={!canEdit}>
                      {isScanning ? 'Scanning…' : 'Scan Project'}
                    </button>
                  </div>
                </div>
                <ul>
                  {(activeProject?.fileMap || []).map((file) => (
                    <li key={file.id}>
                      <button
                        className="ghost small"
                        onClick={() => handleLoadFile(file.path)}
                        disabled={!canViewFiles}
                      >
                        Open
                      </button>
                      <span>{file.path} — {file.summary}</span>
                    </li>
                  ))}
                </ul>
                <div className="file-editor">
                  <div className="file-editor-header">
                    <strong>{selectedFilePath || 'Select a file'}</strong>
                    <button className="primary small" onClick={handleSaveFile} disabled={!canEdit || !selectedFilePath}>
                      Save file
                    </button>
                  </div>
                  <textarea
                    className="file-content"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    placeholder="File contents appear here..."
                    disabled={!canViewFiles || !selectedFilePath}
                    readOnly={!canEdit}
                  />
                  {fileStatus && <span className="muted">{fileStatus}</span>}
                </div>
              </div>

              <div className="insight-block">
                <h4>Change requests</h4>
                <ul>
                  {(activeProject?.changeRequests || []).map((req) => (
                    <li key={req.id}>{req.title} · {req.status}</li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
          )}
        </main>
      </div>

      <section className={workbenchCollapsed ? 'workbench collapsed' : 'workbench'}>
        <div className="workbench-header">
          <div className="workbench-tabs" role="tablist" aria-label="Workbench">
            <button
              type="button"
              className={workbenchTab === 'files' ? 'tab active' : 'tab'}
              onClick={() => setWorkbenchTab('files')}
            >
              Files
            </button>
            <button
              type="button"
              className={workbenchTab === 'ai' ? 'tab active' : 'tab'}
              onClick={() => setWorkbenchTab('ai')}
            >
              AI
            </button>
          </div>
          <div className="workbench-actions">
            <span className="muted">
              {activeProject?.name ? `Workbench · ${activeProject.name}` : 'Workbench'}
            </span>
            <button
              type="button"
              className="ghost small"
              onClick={() => setWorkbenchCollapsed((v) => !v)}
            >
              {workbenchCollapsed ? 'Open' : 'Collapse'}
            </button>
          </div>
        </div>

        {!workbenchCollapsed && (
          <div className="workbench-body">
            {workbenchTab === 'ai' ? (
              <div className="workbench-ai">
                {!activeProject ? (
                  <p className="muted">Select a project first.</p>
                ) : aiOnlyMode ? (
                  <>
                    <div className="file-actions">
                      <select
                        className="role-select"
                        value={activeProject?.selectedModuleId || activeProject?.defaultModuleId || ''}
                        onChange={(e) => {
                          const selectedModuleId = e.target.value
                          updateProject({ ...activeProject, selectedModuleId })
                        }}
                        disabled={!activeProject}
                      >
                        <option value="all">All modules</option>
                        {moduleOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div className="buttons">
                        <button className="ghost small" onClick={openNewModuleModal} disabled={!canManage}>
                          New module
                        </button>
                      </div>
                      <div className="buttons">
                        <button
                          className="primary small"
                          onClick={runAiOnlyFlow}
                          disabled={aiOnlyBusy || !aiOnlyPrompt.trim()}
                        >
                          {aiOnlyBusy ? 'Running…' : 'Run AI'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="overview big"
                      value={aiOnlyPrompt}
                      onChange={(e) => setAiOnlyPrompt(e.target.value)}
                      placeholder="Describe the change. The AI will classify memory + create/edit files."
                    />
                    {aiStatus && <p className="muted">{aiStatus}</p>}
                  </>
                ) : (
                  <>
                    <div className="file-actions">
                      <select
                        className="role-select"
                        value={aiConsoleScope}
                        onChange={(e) => setAiConsoleScope(e.target.value)}
                      >
                        <option value="selected">Context: selected file</option>
                        <option value="all">Context: many files (capped)</option>
                      </select>
                      <div className="buttons">
                        <button
                          className="primary small"
                          onClick={runProjectAICommand}
                          disabled={aiConsoleBusy || !aiPrompt.trim()}
                        >
                          {aiConsoleBusy ? 'Running…' : 'Run AI'}
                        </button>
                        <button className="ghost small" onClick={() => setAiConsoleExpanded(true)}>
                          Pop out
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="overview big"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Ask the AI to change files. It can create new files too."
                    />
                    {aiConsoleReply && (
                      <div className="ai-reply">
                        <strong>AI reply</strong>
                        <pre>{aiConsoleReply}</pre>
                      </div>
                    )}
                    {aiStatus && <p className="muted">{aiStatus}</p>}
                  </>
                )}
              </div>
            ) : (
              <div className="workbench-files">
                {!activeProject ? (
                  <p className="muted">Select a project first.</p>
                ) : (
                  <>
                    <div className="file-actions">
                      <div className="file-root">
                        <span className="muted">Project root</span>
                        <strong>{activeProject?.projectRoot || 'Not set'}</strong>
                      </div>
                      <div className="buttons">
                        <button className="ghost" onClick={handleSelectProjectRoot} disabled={!canManage}>
                          Set Root
                        </button>
                        <button className="ghost" onClick={openNewFileModal} disabled={!canEdit}>
                          New File
                        </button>
                        <button className="ghost" onClick={handleScanProject} disabled={!canEdit}>
                          {isScanning ? 'Scanning…' : 'Scan Project'}
                        </button>
                        <button className="ghost" onClick={() => setFileEditorExpanded(true)} disabled={!selectedFilePath}>
                          Pop out
                        </button>
                      </div>
                    </div>

                    <div className="workbench-split">
                      <div className="workbench-filelist">
                        <input
                          type="search"
                          placeholder="Filter files…"
                          value={fileFilter}
                          onChange={(e) => setFileFilter(e.target.value)}
                        />
                        <div className="filelist-scroll">
                          {(activeProject?.fileMap || [])
                            .filter((f) =>
                              !fileFilter.trim()
                                ? true
                                : f.path.toLowerCase().includes(fileFilter.trim().toLowerCase())
                            )
                            .slice(0, 200)
                            .map((file) => (
                              <button
                                key={file.id}
                                className={file.path === selectedFilePath ? 'file-row active' : 'file-row'}
                                onClick={() => handleLoadFile(file.path)}
                                disabled={!canViewFiles}
                              >
                                <strong>{file.path}</strong>
                                <span className="muted">{file.summary}</span>
                              </button>
                            ))}
                        </div>
                      </div>

                      <div className="workbench-editor">
                        <div className="file-editor-header">
                          <strong>{selectedFilePath || 'Select a file'}</strong>
                          <button className="primary small" onClick={handleSaveFile} disabled={!canEdit || !selectedFilePath}>
                            Save file
                          </button>
                        </div>
                        <textarea
                          className="file-content workbench-text"
                          value={fileContent}
                          onChange={(e) => setFileContent(e.target.value)}
                          placeholder="File contents appear here..."
                          disabled={!canViewFiles || !selectedFilePath}
                          readOnly={!canEdit}
                        />
                        {fileStatus && <span className="muted">{fileStatus}</span>}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <footer>
        <span>Local-first. Your data stays on this machine.</span>
        <span>{version ? `App v${version}` : 'Electron build'}</span>
      </footer>

      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>How Project Brain Works</h3>
            <ol>
              <li>Create your account (only required setup).</li>
              <li>Create or select a project from the left.</li>
              <li>Capture memories, decisions, and next steps.</li>
              <li>Click Host project to accept secure join requests.</li>
              <li>Share the invite code with teammates.</li>
              <li>Approve join requests to keep projects invite-only.</li>
              <li>The app auto-condenses old context so it stays fast.</li>
            </ol>
            <button className="primary" onClick={() => setHelpOpen(false)}>Got it</button>
          </div>
        </div>
      )}

      {setupOpen && (
        <div className="modal-backdrop" onClick={() => setSetupOpen(false)}>
          <div className="modal modal-wide modal-tall" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h2>Quick Setup</h2>
              <div className="buttons">
                <button
                  className="ghost small"
                  onClick={() => {
                    saveSetupDone(true)
                    setSetupOpen(false)
                  }}
                >
                  Skip
                </button>
                <button className="ghost small" onClick={() => setSetupOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className="muted">Step {setupStep + 1} of 5</div>

            {setupStep === 0 && (
              <>
                <p className="muted">
                  Choose what you want to do on this computer. You can always switch later.
                </p>
                <div className="buttons">
                  <button
                    className={setupMode === 'host' ? 'primary' : 'ghost'}
                    onClick={() => setSetupMode('host')}
                    type="button"
                  >
                    Host projects here
                  </button>
                  <button
                    className={setupMode === 'join' ? 'primary' : 'ghost'}
                    onClick={() => setSetupMode('join')}
                    type="button"
                  >
                    Join someone else
                  </button>
                </div>
                <p className="muted">
                  Host mode: your machine is the source of truth for files. Join mode: you can read files and (if permitted) propose or apply edits using AI.
                </p>
              </>
            )}

            {setupStep === 1 && (
              <>
                <p className="muted">Create your account (the only required setup).</p>
                {account ? (
                  <div className="account-card">
                    <strong>{account.name}</strong>
                    <span>@{account.handle}</span>
                    <span className="muted">Account ready.</span>
                  </div>
                ) : (
                  <div className="invite-card">
                    <label>
                      Full name
                      <input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="Your name" />
                    </label>
                    <label>
                      Username
                      <input value={setupHandle} onChange={(e) => setSetupHandle(e.target.value)} placeholder="username" />
                    </label>
                    <div className="buttons">
                      <button
                        className="primary"
                        type="button"
                        onClick={commitSetupAccount}
                        disabled={!setupName.trim() || !setupHandle.trim()}
                      >
                        Create account
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {setupStep === 2 && (
              <>
                <p className="muted">Pick a project and (if hosting) set the project root folder.</p>
                <div className="invite-card">
                  <div className="status-row">
                    <span className="status">Active project</span>
                    <strong>{activeProject?.name || '—'}</strong>
                  </div>
                  <div className="buttons">
                    <button className="ghost" type="button" onClick={handleCreateProject} disabled={!canManage}>
                      New Project
                    </button>
                  </div>
                </div>

                {setupMode === 'host' && (
                  <div className="invite-card">
                    <div className="status-row">
                      <span className="status">Project root</span>
                      <strong>{activeProject?.projectRoot || 'Not set'}</strong>
                    </div>
                    <div className="buttons">
                      <button className="primary" type="button" onClick={handleSelectProjectRoot} disabled={!canManage}>
                        Set Project Root
                      </button>
                      <button className="ghost" type="button" onClick={handleScanProject} disabled={!canEdit}>
                        {isScanning ? 'Scanning…' : 'Scan now'}
                      </button>
                    </div>
                    <p className="muted">
                      Tip: once the root is set, the host auto-scans so collaborators can browse files.
                    </p>
                  </div>
                )}
              </>
            )}

            {setupStep === 3 && (
              <>
                <p className="muted">
                  Choose an AI provider. Pro + AI-only can create new files and edit existing ones.
                </p>
                {!activeProject ? (
                  <p className="muted">Create/select a project first.</p>
                ) : (
                  <div className="invite-card">
                    <select
                      className="role-select"
                      value={activeProject?.ai?.provider || 'local'}
                      disabled={!canManage}
                      onChange={(e) =>
                        updateProject({
                          ...activeProject,
                          ai: { ...(activeProject.ai || {}), provider: e.target.value }
                        })
                      }
                    >
                      <option value="local">Local bot (no LLM)</option>
                      <option value="builtin">Local LLM (Built-in)</option>
                      <option value="ollama">Local LLM (Ollama)</option>
                      <option value="openai">OpenAI Codex</option>
                    </select>
                    <p className="muted">
                      Recommended: Ollama for free local use, or OpenAI for strongest results.
                    </p>
                    <p className="muted">You can change this later from the AI menu.</p>
                  </div>
                )}
              </>
            )}

            {setupStep === 4 && (
              <>
                <p className="muted">Connect with teammates.</p>
                {setupMode === 'host' ? (
                  <div className="invite-card">
                    <p className="muted">Invite code</p>
                    <div className="code">{activeProject?.inviteCode || 'JOIN-0000'}</div>
                    <div className="buttons">
                      <button className="primary" type="button" onClick={startHostSession} disabled={!activeProject}>
                        Host now
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={async () => {
                          const res = await window.projectBrain?.signalStartLocal?.()
                          if (res?.ok) {
                            const preferred = (res.lanUrls && res.lanUrls[0]) || (res.urls && res.urls[0])
                            if (preferred) setServerUrl(preferred)
                            setAiStatus('Local server started (LAN).')
                            setTimeout(() => setAiStatus(''), 1800)
                          }
                        }}
                      >
                        Start LAN server
                      </button>
                    </div>
                    <p className="muted">For internet-wide access, use a Cloudflare Worker signaling URL.</p>
                  </div>
                ) : (
                  <div className="invite-card">
                    <label>
                      Signaling server URL
                      <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="wss://…" />
                    </label>
                    <label>
                      Invite code
                      <input value={inviteCodeInput} onChange={(e) => setInviteCodeInput(e.target.value)} placeholder="JOIN-ABCD" />
                    </label>
                    <label>
                      Your name
                      <input
                        value={inviteNameInput}
                        onChange={(e) => setInviteNameInput(e.target.value)}
                        placeholder={account?.name || 'Your name'}
                      />
                    </label>
                    <div className="buttons">
                      <button className="primary" type="button" onClick={handleJoinRequest} disabled={!inviteCodeInput.trim()}>
                        Request access
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="buttons">
              <button
                className="ghost"
                type="button"
                onClick={() => setSetupStep((s) => Math.max(0, s - 1))}
                disabled={setupStep === 0}
              >
                Back
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  if (setupStep === 4) {
                    saveSetupDone(true)
                    setSetupOpen(false)
                    return
                  }
                  setSetupStep((s) => Math.min(4, s + 1))
                }}
              >
                {setupStep === 4 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {newProjectOpen && (
        <div className="modal-backdrop" onClick={() => setNewProjectOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Project</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitCreateProject(newProjectName)
              }}
            >
              <label>
                Project name
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Acme Website Redesign"
                />
              </label>
              <div className="buttons">
                <button className="ghost" type="button" onClick={() => setNewProjectOpen(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={!newProjectName.trim()}>
                  Create project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {archivedMemoryOpen && (
        <div className="modal-backdrop" onClick={() => setArchivedMemoryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Archived Memory</h3>
            {archivedMemory ? (
              <>
                <p className="muted">Condensed at: {formatDate(archivedMemory.condensedAt || archivedMemory.updatedAt)}</p>
                <strong>{archivedMemory.title}</strong>
                <pre className="ai-reply">{archivedMemory.body}</pre>
              </>
            ) : (
              <p className="muted">No archived copy found.</p>
            )}
            <div className="buttons">
              <button className="primary" onClick={() => setArchivedMemoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {aiConsoleExpanded && (
        <div className="modal-backdrop" onClick={() => setAiConsoleExpanded(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h2>AI Command</h2>
              <button className="ghost small" onClick={() => setAiConsoleExpanded(false)}>Close</button>
            </div>
            <p className="muted">
              Auto-uploads project context for Host/Admin/Editor. Captures intent to memory automatically.
            </p>
            <div className="file-actions">
              <select
                className="role-select"
                value={aiConsoleScope}
                onChange={(e) => setAiConsoleScope(e.target.value)}
              >
                <option value="selected">Context: selected file</option>
                <option value="all">Context: many files (capped)</option>
              </select>
              <div className="buttons">
                <button className="primary small" onClick={runProjectAICommand} disabled={aiConsoleBusy || !aiPrompt.trim()}>
                  {aiConsoleBusy ? 'Running…' : 'Run AI'}
                </button>
              </div>
            </div>
            <textarea
              className="overview big"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe the change. Include file names if you know them."
            />
            {aiConsoleReply && (
              <div className="ai-reply">
                <strong>AI reply</strong>
                <pre>{aiConsoleReply}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {fileEditorExpanded && (
        <div className="modal-backdrop" onClick={() => setFileEditorExpanded(false)}>
          <div className="modal modal-wide modal-tall" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h2>File Editor</h2>
              <button className="ghost small" onClick={() => setFileEditorExpanded(false)}>Close</button>
            </div>
            <div className="file-actions">
              <div className="file-root">
                <span className="muted">File</span>
                <strong>{selectedFilePath || '—'}</strong>
              </div>
              <div className="buttons">
                <button className="ghost small" onClick={openNewFileModal} disabled={!canEdit}>
                  New File
                </button>
                <button className="primary small" onClick={handleSaveFile} disabled={!canEdit || !selectedFilePath}>
                  Save file
                </button>
              </div>
            </div>
            <textarea
              className="file-content file-content-big"
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              placeholder="File contents appear here..."
              disabled={!canViewFiles || !selectedFilePath}
              readOnly={!canEdit}
            />
            {fileStatus && <span className="muted">{fileStatus}</span>}
          </div>
        </div>
      )}

      {newModuleOpen && (
        <div className="modal-backdrop" onClick={() => setNewModuleOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Module</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitCreateModule()
              }}
            >
              <label>
                Module name
                <input
                  autoFocus
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  placeholder="e.g. Movement, Graphics, UI"
                />
              </label>
              <label>
                Parent module
                <select
                  className="role-select"
                  value={newModuleParentId}
                  onChange={(e) => setNewModuleParentId(e.target.value)}
                >
                  {moduleOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="buttons">
                <button className="ghost" type="button" onClick={() => setNewModuleOpen(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={!newModuleName.trim()}>
                  Create module
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newFileOpen && (
        <div className="modal-backdrop" onClick={() => setNewFileOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New File</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitCreateFile()
              }}
            >
              <label>
                Relative path (inside project root)
                <input
                  autoFocus
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="e.g. src/newFeature.js"
                />
              </label>
              {isHostLike && !activeProject?.projectRoot && (
                <p className="muted">Set the project root first (File map → Set Root).</p>
              )}
              <label>
                Initial contents
                <textarea
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  placeholder="(optional)"
                />
              </label>
              <div className="buttons">
                <button className="ghost" type="button" onClick={() => setNewFileOpen(false)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={!newFilePath.trim() || (isHostLike && !activeProject?.projectRoot)}
                >
                  Create file
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
