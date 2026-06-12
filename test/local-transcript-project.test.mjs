import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildBenchmarkRows,
  estimateHardwareLane,
  formatBytes,
  getFileProfile,
  MODEL_CANDIDATES,
} from '../src/lib/asr-candidates.js'
import {
  buildExportPackage,
  buildExportZipArchive,
  cancelRunner,
  compileSrt,
  compileVtt,
  createChunkManifest,
  createChunkRunnerState,
  createProjectManifest,
  createProjectSnapshot,
  completeRunnerChunk,
  failRunnerChunk,
  findNextPendingChunk,
  getRunnerSummary,
  normalizeAsrSegments,
  planChunks,
  retryFailedRunnerChunks,
  startNextRunnerChunk,
  updateChunkStatus,
} from '../src/lib/local-transcript-project.js'
import {
  bucketBytes,
  createLocalEvent,
  recordLocalEvent,
  readLocalEvents,
} from '../src/lib/local-events.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

test('defines browser-local RU+EN ASR candidates without model weights', () => {
  const parakeet = MODEL_CANDIDATES.find((candidate) => candidate.id === 'sherpa-parakeet-v3-int8')
  const gigaam = MODEL_CANDIDATES.find((candidate) => candidate.id === 'sherpa-gigaam-russian')
  const whisper = MODEL_CANDIDATES.find((candidate) => candidate.id === 'transformers-whisper-large-v3-turbo')

  assert.ok(parakeet)
  assert.ok(gigaam)
  assert.ok(whisper)
  assert.equal(parakeet.runtime, 'sherpa-onnx')
  assert.ok(parakeet.languages.includes('English'))
  assert.ok(parakeet.languages.includes('Russian'))
  assert.equal(gigaam.role, 'Russian quality candidate')
  assert.equal(whisper.runtime, 'Transformers.js')
})

test('classifies browser hardware conservatively', () => {
  const recommended = estimateHardwareLane({
    cores: 12,
    memoryGb: 32,
    webgpu: true,
    webassembly: true,
    worker: true,
    audioContext: true,
    sharedArrayBuffer: true,
    crossOriginIsolated: true,
    benchmarkMs: 20,
  })
  const unsupported = estimateHardwareLane({
    cores: 2,
    memoryGb: 4,
    webgpu: false,
    webassembly: false,
    worker: true,
    audioContext: true,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    benchmarkMs: 0,
  })

  assert.equal(recommended.lane, 'recommended')
  assert.equal(unsupported.lane, 'unsupported')
  assert.match(unsupported.blockers.join(' '), /WebAssembly/)
})

test('builds project manifests, chunk plans, and export package files', () => {
  const file = { name: 'meeting.mp4', type: 'video/mp4', size: 1024 * 1024 * 400 }
  const profile = getFileProfile(file, 120)
  const project = createProjectManifest({
    fileProfile: profile,
    hardwareLane: { lane: 'slow', label: 'Slow but usable', score: 40, blockers: [], strengths: [] },
    capabilities: { cores: 8, memoryGb: 16, webassembly: true, worker: true, audioContext: true },
    createdAt: '2026-06-12T10:00:00.000Z',
  })
  const chunkManifest = createChunkManifest(profile, { chunkSeconds: 30, overlapSeconds: 5 })
  const segments = normalizeAsrSegments({
    chunks: [
      { timestamp: [0.2, 3.4], text: ' First line from the local model. ' },
      { timestamp: [3.4, 8.9], text: 'Second line.' },
    ],
  }, {
    chunk: chunkManifest.chunks[1],
    engineId: 'transformers-whisper-large-v3-turbo',
  })
  const files = buildExportPackage(project, segments, { chunkManifest })

  assert.equal(formatBytes(487170055), '465 MB')
  assert.equal(profile.durationLabel, '2m 0s')
  assert.equal(project.privacy.sourceMediaUpload, false)
  assert.deepEqual(planChunks(65, { chunkSeconds: 30, overlapSeconds: 5 }).map((chunk) => [chunk.startSeconds, chunk.endSeconds]), [
    [0, 30],
    [25, 55],
    [50, 65],
  ])
  assert.equal(segments[0].startSeconds, 25.2)
  assert.match(files['transcript.md'], /First line from the local model/)
  assert.match(files['transcript.txt'], /\[00:00:25\]/)
  assert.match(compileSrt(segments), /00:00:25,200 --> 00:00:28,400/)
  assert.match(compileVtt(segments), /^WEBVTT/)
  assert.match(files['qa-notes.md'], /Chunk count: 5/)
})

test('runs chunk state transitions with cancel and retry', () => {
  const profile = getFileProfile({ name: 'audio.wav', type: 'audio/wav', size: 1024 * 1024 * 90 }, 65)
  const project = createProjectManifest({
    fileProfile: profile,
    hardwareLane: { lane: 'recommended', label: 'Recommended', score: 88, blockers: [], strengths: [] },
    capabilities: { cores: 12, memoryGb: 32, webgpu: true, webassembly: true, worker: true, audioContext: true },
    createdAt: '2026-06-12T11:00:00.000Z',
  })
  const chunkManifest = createChunkManifest(profile, { chunkSeconds: 30, overlapSeconds: 5 })
  let runner = createChunkRunnerState(chunkManifest, {
    engineId: 'transformers-whisper-large-v3-turbo',
    now: '2026-06-12T11:01:00.000Z',
  })

  assert.equal(getRunnerSummary(runner).pending, 3)
  assert.equal(findNextPendingChunk(runner.chunks).id, 'chunk-0001')

  runner = startNextRunnerChunk(runner, { now: '2026-06-12T11:02:00.000Z' })
  runner = completeRunnerChunk(runner, 'chunk-0001', {
    chunks: [{ timestamp: [0, 2.5], text: 'Local chunk transcript.' }],
  }, {
    engineId: 'transformers-whisper-large-v3-turbo',
    now: '2026-06-12T11:03:00.000Z',
  })
  assert.equal(runner.status, 'idle')
  assert.equal(getRunnerSummary(runner).done, 1)

  runner = startNextRunnerChunk(runner, { now: '2026-06-12T11:04:00.000Z' })
  runner = cancelRunner(runner, { now: '2026-06-12T11:05:00.000Z' })
  assert.equal(runner.status, 'canceled')

  runner = startNextRunnerChunk(runner, { now: '2026-06-12T11:06:00.000Z' })
  runner = failRunnerChunk(runner, 'chunk-0002', 'Model fetch failed', { now: '2026-06-12T11:07:00.000Z' })
  assert.equal(getRunnerSummary(runner).failed, 1)

  runner = retryFailedRunnerChunks(runner, { now: '2026-06-12T11:08:00.000Z' })
  assert.equal(runner.status, 'idle')
  assert.equal(getRunnerSummary(runner).pending, 2)

  const snapshot = createProjectSnapshot(project, chunkManifest, runner.segments, {
    runnerState: runner,
    updatedAt: '2026-06-12T11:09:00.000Z',
    status: 'checkpoint',
  })
  assert.equal(snapshot.runnerState.status, 'idle')
})

test('builds deterministic ZIP exports and sanitizes local-only events', () => {
  const archive = buildExportZipArchive(buildExportPackage(null, []), {
    timestamp: '2026-06-12T12:00:00.000Z',
  })
  const rows = buildBenchmarkRows({
    cores: 8,
    memoryGb: 16,
    webgpu: true,
    webassembly: true,
    worker: true,
    audioContext: true,
    sharedArrayBuffer: true,
    crossOriginIsolated: true,
    benchmarkMs: 40,
  })
  const store = new Map()
  const storage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
  }
  const event = createLocalEvent({
    event: 'input_selected',
    funnelStep: 'input',
    metrics: { fileSizeBucket: bucketBytes(123), localPath: '/private/path' },
    properties: { fileName: 'private.mp4', mimeType: 'video/mp4' },
  })
  recordLocalEvent(event, storage)

  assert.equal(new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(0, true), 0x04034b50)
  assert.ok(rows.some((row) => row.readiness === 'First candidate'))
  assert.equal(readLocalEvents(storage).length, 1)
  assert.equal(readLocalEvents(storage)[0].metrics.localPath, undefined)
  assert.equal(readLocalEvents(storage)[0].properties.fileName, undefined)
  assert.equal(readLocalEvents(storage)[0].properties.mimeType, 'video/mp4')
})

test('keeps the standalone app detached from the KikuAI site runtime', async () => {
  const app = await read('src/App.vue')
  const pkg = await read('package.json')
  const readme = await read('README.md')
  const oldSiteHost = ['kikuai', 'dev'].join('.')
  const oldEventPath = ['', 'api', ['kiku', 'tools'].join('')].join('/')

  assert.match(app, /Long Video Transcriber/)
  assert.match(app, /decodeMediaAudioBuffer/)
  assert.match(app, /Download ZIP/)
  assert.match(pkg, /@huggingface\/transformers/)
  assert.match(readme, /browser-local/i)
  assert.equal(app.includes('Nuxt'), false)
  assert.equal(app.includes('Navbar'), false)
  assert.equal(app.includes('Footer'), false)
  assert.equal(app.includes('KikuTools'), false)
  assert.equal(app.includes(oldSiteHost), false)
  assert.equal(app.includes(oldEventPath), false)
  assert.doesNotMatch(readme, /token|cookie|local path|private sample/i)
})
