import { OUTPUT_FILES, formatDuration } from './asr-candidates.js'

export const PROJECT_SCHEMA_VERSION = 1
export const DEFAULT_CHUNK_SECONDS = 30
export const DEFAULT_CHUNK_OVERLAP_SECONDS = 5
export const RUNNER_SCHEMA_VERSION = 1

export const ASR_ADAPTERS = [
  {
    id: 'transformers-whisper-large-v3-turbo',
    runtime: 'Transformers.js',
    status: 'implemented-baseline',
    input: 'browser object URL',
    output: 'text plus optional timestamp chunks',
  },
  {
    id: 'sherpa-parakeet-v3-int8',
    runtime: 'sherpa-onnx',
    status: 'benchmark-candidate',
    input: 'decoded chunk audio buffer',
    output: 'timestamped segments',
  },
  {
    id: 'sherpa-gigaam-russian',
    runtime: 'sherpa-onnx',
    status: 'ru-quality-candidate',
    input: 'decoded chunk audio buffer',
    output: 'timestamped Russian segments',
  },
]

export function createProjectManifest({
  fileProfile,
  hardwareLane,
  capabilities,
  selectedAdapterId = 'transformers-whisper-large-v3-turbo',
  createdAt = new Date().toISOString(),
}) {
  const sourceFingerprint = createSourceFingerprint(fileProfile)
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: `local-asr-${sourceFingerprint}`,
    createdAt,
    sourceFingerprint,
    selectedAdapterId,
    file: {
      name: fileProfile?.name || 'unknown',
      type: fileProfile?.type || 'unknown',
      extension: fileProfile?.extension || 'unknown',
      sizeBytes: finiteOrNull(fileProfile?.sizeBytes),
      durationSeconds: finiteOrNull(fileProfile?.durationSeconds),
      durationLabel: fileProfile?.durationLabel || 'Unknown',
    },
    hardware: {
      lane: hardwareLane?.lane || 'unknown',
      label: hardwareLane?.label || 'Unknown',
      score: finiteOrNull(hardwareLane?.score),
      blockers: Array.isArray(hardwareLane?.blockers) ? hardwareLane.blockers : [],
      strengths: Array.isArray(hardwareLane?.strengths) ? hardwareLane.strengths : [],
    },
    capabilities: sanitizeCapabilities(capabilities),
    privacy: {
      sourceMediaUpload: false,
      localProjectPersistence: true,
      providerUpload: false,
    },
  }
}

export function createChunkManifest(fileProfile, options = {}) {
  const chunkSeconds = normalizePositiveNumber(options.chunkSeconds, DEFAULT_CHUNK_SECONDS)
  const overlapSeconds = normalizeNonNegativeNumber(options.overlapSeconds, DEFAULT_CHUNK_OVERLAP_SECONDS)
  const durationSeconds = finiteOrNull(fileProfile?.durationSeconds)
  const safeOverlapSeconds = Math.min(overlapSeconds, Math.max(0, chunkSeconds - 1))

  return {
    chunkSeconds,
    overlapSeconds: safeOverlapSeconds,
    durationSeconds,
    chunks: planChunks(durationSeconds, {
      chunkSeconds,
      overlapSeconds: safeOverlapSeconds,
    }),
  }
}

export function planChunks(durationSeconds, options = {}) {
  const duration = finiteOrNull(durationSeconds)
  if (!duration) return []

  const chunkSeconds = normalizePositiveNumber(options.chunkSeconds, DEFAULT_CHUNK_SECONDS)
  const overlapSeconds = Math.min(
    normalizeNonNegativeNumber(options.overlapSeconds, DEFAULT_CHUNK_OVERLAP_SECONDS),
    Math.max(0, chunkSeconds - 1)
  )
  const stepSeconds = Math.max(1, chunkSeconds - overlapSeconds)
  const chunks = []
  let startSeconds = 0

  while (startSeconds < duration) {
    const endSeconds = Math.min(duration, startSeconds + chunkSeconds)
    const index = chunks.length
    chunks.push({
      id: `chunk-${String(index + 1).padStart(4, '0')}`,
      index,
      startSeconds: roundSeconds(startSeconds),
      endSeconds: roundSeconds(endSeconds),
      durationSeconds: roundSeconds(endSeconds - startSeconds),
      status: 'pending',
      attempts: 0,
    })

    if (endSeconds >= duration) break
    startSeconds += stepSeconds
  }

  return chunks
}

export function findNextPendingChunk(chunks) {
  if (!Array.isArray(chunks)) return null
  return chunks.find((chunk) => chunk.status !== 'done') || null
}

export function findNextRunnableChunk(chunks) {
  if (!Array.isArray(chunks)) return null
  return chunks.find((chunk) => chunk.status === 'pending') || null
}

export function updateChunkStatus(chunks, chunkId, status, patch = {}) {
  if (!Array.isArray(chunks)) return []
  return chunks.map((chunk) => {
    if (chunk.id !== chunkId) return chunk
    return {
      ...chunk,
      ...patch,
      status,
      attempts: status === 'running' ? (chunk.attempts || 0) + 1 : (patch.attempts ?? chunk.attempts ?? 0),
    }
  })
}

export function createChunkRunnerState(chunkManifest, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(chunkManifest?.chunks)
  const initialSegments = sortSegments(options.segments)

  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    status: chunks.length > 0 ? 'idle' : 'blocked',
    engineId: options.engineId || 'unknown',
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    activeChunkId: null,
    chunkSeconds: normalizePositiveNumber(chunkManifest?.chunkSeconds, DEFAULT_CHUNK_SECONDS),
    overlapSeconds: normalizeNonNegativeNumber(chunkManifest?.overlapSeconds, DEFAULT_CHUNK_OVERLAP_SECONDS),
    chunks,
    segments: initialSegments,
    errors: [],
  }
}

export function startNextRunnerChunk(runnerState, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(runnerState?.chunks)
  const nextChunk = findNextRunnableChunk(chunks)

  if (!nextChunk) {
    return {
      ...normalizeRunnerState(runnerState, now),
      status: chunks.every((chunk) => chunk.status === 'done') && chunks.length > 0 ? 'completed' : 'blocked',
      activeChunkId: null,
      completedAt: chunks.every((chunk) => chunk.status === 'done') && chunks.length > 0 ? now : runnerState?.completedAt || null,
      updatedAt: now,
      chunks,
    }
  }

  return {
    ...normalizeRunnerState(runnerState, now),
    status: 'running',
    startedAt: runnerState?.startedAt || now,
    completedAt: null,
    activeChunkId: nextChunk.id,
    updatedAt: now,
    chunks: updateChunkStatus(chunks, nextChunk.id, 'running', {
      startedAt: now,
      error: null,
    }),
  }
}

export function completeRunnerChunk(runnerState, chunkId, result, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(runnerState?.chunks)
  const chunk = chunks.find((item) => item.id === chunkId)

  if (!chunk) {
    return failRunnerChunk(runnerState, chunkId, `Unknown chunk: ${chunkId}`, { now })
  }

  const newSegments = normalizeAsrSegments(result, {
    chunk,
    engineId: options.engineId || runnerState?.engineId || 'unknown',
  })
  const existingSegments = sortSegments(runnerState?.segments).filter((segment) => segment.chunkId !== chunkId)
  const updatedChunks = updateChunkStatus(chunks, chunkId, 'done', {
    finishedAt: now,
    error: null,
  })
  const hasPending = Boolean(findNextRunnableChunk(updatedChunks))
  const allDone = updatedChunks.length > 0 && updatedChunks.every((item) => item.status === 'done')

  return {
    ...normalizeRunnerState(runnerState, now),
    status: allDone ? 'completed' : hasPending ? 'idle' : 'blocked',
    completedAt: allDone ? now : null,
    activeChunkId: null,
    updatedAt: now,
    chunks: updatedChunks,
    segments: sortSegments([...existingSegments, ...newSegments]),
  }
}

export function failRunnerChunk(runnerState, chunkId, message, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(runnerState?.chunks)
  const safeMessage = normalizeText(message) || 'Chunk failed'

  return {
    ...normalizeRunnerState(runnerState, now),
    status: 'failed',
    activeChunkId: null,
    updatedAt: now,
    chunks: updateChunkStatus(chunks, chunkId, 'failed', {
      finishedAt: now,
      error: safeMessage,
    }),
    errors: [
      ...normalizeErrors(runnerState?.errors),
      {
        chunkId,
        message: safeMessage,
        at: now,
      },
    ],
  }
}

export function cancelRunner(runnerState, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(runnerState?.chunks).map((chunk) => {
    if (chunk.status !== 'running') return chunk
    return {
      ...chunk,
      status: 'pending',
      canceledAt: now,
    }
  })

  return {
    ...normalizeRunnerState(runnerState, now),
    status: 'canceled',
    activeChunkId: null,
    updatedAt: now,
    chunks,
  }
}

export function retryFailedRunnerChunks(runnerState, options = {}) {
  const now = options.now || new Date().toISOString()
  const chunks = cloneChunks(runnerState?.chunks).map((chunk) => {
    if (chunk.status !== 'failed' && chunk.status !== 'canceled') return chunk
    const { error, ...rest } = chunk
    return {
      ...rest,
      status: 'pending',
      retryQueuedAt: now,
    }
  })

  return {
    ...normalizeRunnerState(runnerState, now),
    status: findNextRunnableChunk(chunks) ? 'idle' : 'blocked',
    activeChunkId: null,
    updatedAt: now,
    chunks,
  }
}

export function getRunnerSummary(runnerState) {
  const chunks = cloneChunks(runnerState?.chunks)
  const countByStatus = chunks.reduce((summary, chunk) => {
    summary[chunk.status] = (summary[chunk.status] || 0) + 1
    return summary
  }, {})

  return {
    status: runnerState?.status || 'missing',
    total: chunks.length,
    pending: countByStatus.pending || 0,
    running: countByStatus.running || 0,
    done: countByStatus.done || 0,
    failed: countByStatus.failed || 0,
    canceled: countByStatus.canceled || 0,
    segmentCount: Array.isArray(runnerState?.segments) ? runnerState.segments.length : 0,
    nextChunk: findNextRunnableChunk(chunks),
  }
}

export function normalizeAsrSegments(result, context = {}) {
  const chunk = context.chunk || { startSeconds: 0, endSeconds: 0 }
  const engineId = context.engineId || 'unknown'
  const sourceChunks = Array.isArray(result?.chunks) ? result.chunks : []

  if (sourceChunks.length > 0) {
    return sourceChunks
      .map((sourceChunk, index) => {
        const [localStart, localEnd] = normalizeTimestampPair(sourceChunk.timestamp)
        const text = normalizeText(sourceChunk.text)
        if (!text) return null
        return createSegment({
          id: `${chunk.id || 'chunk'}-seg-${String(index + 1).padStart(3, '0')}`,
          startSeconds: chunk.startSeconds + localStart,
          endSeconds: chunk.startSeconds + localEnd,
          text,
          engineId,
          chunkId: chunk.id,
        })
      })
      .filter(Boolean)
  }

  const text = normalizeText(typeof result === 'string' ? result : result?.text)
  if (!text) return []

  return [
    createSegment({
      id: `${chunk.id || 'chunk'}-seg-001`,
      startSeconds: chunk.startSeconds || 0,
      endSeconds: chunk.endSeconds || Math.max((chunk.startSeconds || 0) + 1, 1),
      text,
      engineId,
      chunkId: chunk.id,
    }),
  ]
}

export function buildExportPackage(project, segments, options = {}) {
  const title = options.title || project?.file?.name || 'local media'
  const sortedSegments = sortSegments(segments)
  const files = {
    'transcript.md': compileTranscriptMarkdown(project, sortedSegments, { title }),
    'transcript.txt': compileTranscriptText(sortedSegments),
    'subtitles.srt': compileSrt(sortedSegments),
    'subtitles.vtt': compileVtt(sortedSegments),
    'qa-notes.md': compileQaNotes(project, sortedSegments, options.chunkManifest),
  }

  return OUTPUT_FILES.reduce((packageFiles, fileName) => {
    packageFiles[fileName] = files[fileName]
    return packageFiles
  }, {})
}

export function buildExportZipArchive(exportPackage, options = {}) {
  return buildZipArchive(exportPackage, {
    timestamp: options.timestamp || new Date().toISOString(),
  })
}

export function buildZipArchive(files, options = {}) {
  const encoder = new TextEncoder()
  const entries = Object.entries(files || {})
    .map(([name, content]) => ({
      name: sanitizeZipFileName(name),
      bytes: encodeZipContent(content, encoder),
    }))
    .filter((entry) => entry.name && entry.bytes.length >= 0)
  const { dosTime, dosDate } = toDosTimestamp(options.timestamp)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.bytes)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(localHeader.buffer)

    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, dosTime, true)
    localView.setUint16(12, dosDate, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, entry.bytes.length, true)
    localView.setUint32(22, entry.bytes.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)
    localParts.push(localHeader, entry.bytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, dosTime, true)
    centralView.setUint16(14, dosDate, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, entry.bytes.length, true)
    centralView.setUint32(24, entry.bytes.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(nameBytes, 46)
    centralParts.push(centralHeader)

    offset += localHeader.length + entry.bytes.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const endHeader = new Uint8Array(22)
  const endView = new DataView(endHeader.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralOffset, true)
  endView.setUint16(20, 0, true)

  return concatUint8Arrays([...localParts, ...centralParts, endHeader])
}

export function compileTranscriptMarkdown(project, segments, options = {}) {
  const title = options.title || project?.file?.name || 'local media'
  const lines = [
    `# Transcript: ${title}`,
    '',
    `- Source: ${project?.file?.name || 'unknown'}`,
    `- Duration: ${project?.file?.durationLabel || formatDuration(project?.file?.durationSeconds)}`,
    `- ASR adapter: ${project?.selectedAdapterId || 'unknown'}`,
    `- Local-only source media: ${project?.privacy?.sourceMediaUpload === false ? 'yes' : 'unknown'}`,
    '',
    '## Transcript',
    '',
  ]

  if (!segments.length) {
    lines.push('_No transcript segments yet._')
    return `${lines.join('\n')}\n`
  }

  for (const segment of sortSegments(segments)) {
    lines.push(`**${formatTimestamp(segment.startSeconds)}** ${segment.text}`)
  }

  return `${lines.join('\n')}\n`
}

export function compileTranscriptText(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return ''
  return `${sortSegments(segments)
    .map((segment) => `[${formatTimestamp(segment.startSeconds)}] ${segment.text}`)
    .join('\n')}\n`
}

export function compileSrt(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return ''
  return `${sortSegments(segments)
    .map((segment, index) => [
      String(index + 1),
      `${formatSubtitleTimestamp(segment.startSeconds, ',')} --> ${formatSubtitleTimestamp(segment.endSeconds, ',')}`,
      segment.text,
    ].join('\n'))
    .join('\n\n')}\n`
}

export function compileVtt(segments) {
  const body = Array.isArray(segments) && segments.length > 0
    ? sortSegments(segments)
      .map((segment) => `${formatSubtitleTimestamp(segment.startSeconds, '.')} --> ${formatSubtitleTimestamp(segment.endSeconds, '.')}\n${segment.text}`)
      .join('\n\n')
    : ''

  return `WEBVTT\n\n${body}${body ? '\n' : ''}`
}

export function compileQaNotes(project, segments, chunkManifest = null) {
  const warnings = []
  const duration = finiteOrNull(project?.file?.durationSeconds)
  const chunks = Array.isArray(chunkManifest?.chunks) ? chunkManifest.chunks : []

  if (!duration) warnings.push('Media duration is unknown; chunking cannot be validated.')
  if (chunks.length === 0) warnings.push('No chunk manifest is available yet.')
  if (!Array.isArray(segments) || segments.length === 0) warnings.push('No transcript segments are available yet.')
  if (hasOverlappingSegments(segments)) warnings.push('Some transcript segments overlap after normalization.')

  const lines = [
    '# QA notes',
    '',
    `- Source fingerprint: ${project?.sourceFingerprint || 'unknown'}`,
    `- Chunk count: ${chunks.length}`,
    `- Segment count: ${Array.isArray(segments) ? segments.length : 0}`,
    '',
    '## Flags',
    '',
  ]

  if (warnings.length === 0) {
    lines.push('- No deterministic packager warnings.')
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export function buildPersistencePlan(features) {
  const hasIndexedDb = features?.indexedDB === true
  const hasOpfs = features?.opfs === true
  const hasStorageEstimate = features?.storageEstimate === true

  if (hasIndexedDb && hasOpfs) {
    return {
      mode: 'indexeddb-opfs',
      label: 'IndexedDB + OPFS',
      canResume: true,
      summary: 'Project metadata can be indexed and snapshots can be written to browser private storage.',
    }
  }

  if (hasIndexedDb) {
    return {
      mode: 'indexeddb',
      label: 'IndexedDB',
      canResume: true,
      summary: 'Project metadata can be saved; large chunk files need a browser-specific fallback.',
    }
  }

  return {
    mode: 'memory',
    label: hasStorageEstimate ? 'Session memory' : 'Limited session',
    canResume: false,
    summary: 'The page can run a smoke test, but resume checkpoints are not durable in this browser.',
  }
}

export function createProjectSnapshot(project, chunkManifest, segments = [], extra = {}) {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    project,
    chunkManifest,
    segments: sortSegments(segments),
    runnerState: extra.runnerState || null,
    updatedAt: extra.updatedAt || new Date().toISOString(),
    status: extra.status || 'draft',
  }
}

export function formatTimestamp(seconds) {
  const value = normalizeNonNegativeNumber(seconds, 0)
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const rest = Math.floor(value % 60)
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatSubtitleTimestamp(seconds, millisecondSeparator) {
  const value = normalizeNonNegativeNumber(seconds, 0)
  const totalMilliseconds = Math.round(value * 1000)
  const hours = Math.floor(totalMilliseconds / 3600000)
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000)
  const rest = Math.floor((totalMilliseconds % 60000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}${millisecondSeparator}${String(milliseconds).padStart(3, '0')}`
}

function createSourceFingerprint(fileProfile) {
  const source = [
    fileProfile?.name || 'unknown',
    fileProfile?.type || 'unknown',
    fileProfile?.sizeBytes || 0,
    finiteOrNull(fileProfile?.durationSeconds) || 0,
  ].join('|')

  return hashText(source)
}

function normalizeRunnerState(runnerState, now) {
  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    status: runnerState?.status || 'idle',
    engineId: runnerState?.engineId || 'unknown',
    startedAt: runnerState?.startedAt || null,
    completedAt: runnerState?.completedAt || null,
    updatedAt: runnerState?.updatedAt || now,
    activeChunkId: runnerState?.activeChunkId || null,
    chunkSeconds: normalizePositiveNumber(runnerState?.chunkSeconds, DEFAULT_CHUNK_SECONDS),
    overlapSeconds: normalizeNonNegativeNumber(runnerState?.overlapSeconds, DEFAULT_CHUNK_OVERLAP_SECONDS),
    chunks: cloneChunks(runnerState?.chunks),
    segments: sortSegments(runnerState?.segments),
    errors: normalizeErrors(runnerState?.errors),
  }
}

function cloneChunks(chunks) {
  if (!Array.isArray(chunks)) return []
  return chunks.map((chunk) => ({ ...chunk }))
}

function normalizeErrors(errors) {
  if (!Array.isArray(errors)) return []
  return errors
    .filter((error) => error && typeof error.message === 'string')
    .map((error) => ({
      chunkId: typeof error.chunkId === 'string' ? error.chunkId : 'unknown',
      message: error.message,
      at: typeof error.at === 'string' ? error.at : '',
    }))
}

function sanitizeCapabilities(capabilities = {}) {
  return {
    cores: finiteOrNull(capabilities.cores),
    memoryGb: finiteOrNull(capabilities.memoryGb),
    webgpu: capabilities.webgpu === true,
    webassembly: capabilities.webassembly === true,
    worker: capabilities.worker === true,
    audioContext: capabilities.audioContext === true,
    sharedArrayBuffer: capabilities.sharedArrayBuffer === true,
    crossOriginIsolated: capabilities.crossOriginIsolated === true,
    benchmarkMs: finiteOrNull(capabilities.benchmarkMs),
  }
}

function createSegment({ id, startSeconds, endSeconds, text, engineId, chunkId }) {
  const start = normalizeNonNegativeNumber(startSeconds, 0)
  const end = Math.max(start + 0.1, normalizeNonNegativeNumber(endSeconds, start + 1))
  return {
    id,
    chunkId,
    engineId,
    startSeconds: roundSeconds(start),
    endSeconds: roundSeconds(end),
    text,
  }
}

function normalizeTimestampPair(timestamp) {
  if (!Array.isArray(timestamp)) return [0, 1]
  const start = normalizeNonNegativeNumber(timestamp[0], 0)
  const end = Math.max(start + 0.1, normalizeNonNegativeNumber(timestamp[1], start + 1))
  return [start, end]
}

function sortSegments(segments) {
  if (!Array.isArray(segments)) return []
  return [...segments].sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds)
}

function hasOverlappingSegments(segments) {
  const sorted = sortSegments(segments)
  return sorted.some((segment, index) => index > 0 && segment.startSeconds < sorted[index - 1].endSeconds)
}

function normalizeText(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\s+/g, ' ').trim()
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function normalizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeNonNegativeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function roundSeconds(value) {
  return Math.round(value * 1000) / 1000
}

function hashText(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function encodeZipContent(content, encoder) {
  if (content instanceof Uint8Array) return content
  if (typeof content === 'string') return encoder.encode(content)
  return encoder.encode(JSON.stringify(content ?? '', null, 2))
}

function sanitizeZipFileName(fileName) {
  if (typeof fileName !== 'string') return ''
  return fileName
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
}

function toDosTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date()
  const safeDate = Number.isNaN(date.getTime()) ? new Date('1980-01-01T00:00:00.000Z') : date
  const year = Math.min(2107, Math.max(1980, safeDate.getUTCFullYear()))
  const month = safeDate.getUTCMonth() + 1
  const day = safeDate.getUTCDate()
  const hours = safeDate.getUTCHours()
  const minutes = safeDate.getUTCMinutes()
  const seconds = Math.floor(safeDate.getUTCSeconds() / 2)

  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
  }
}

function concatUint8Arrays(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[index]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = createCrc32Table()

function createCrc32Table() {
  const table = []
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table.push(value >>> 0)
  }
  return table
}
