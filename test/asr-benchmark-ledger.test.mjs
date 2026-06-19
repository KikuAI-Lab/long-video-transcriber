import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { OUTPUT_FILES } from '../src/lib/asr-candidates.js'
import {
  requiredBenchmarkMatrix,
  summarizeBenchmarkLedger,
  validateBenchmarkRecord,
} from '../src/lib/asr-benchmark-ledger.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readManifest() {
  return JSON.parse(await readFile(path.join(root, 'docs/benchmarks/asr-benchmark-manifest-2026-06-18.json'), 'utf8'))
}

function validRecord(patch = {}) {
  return {
    runId: 'run-001',
    adapterId: 'transformers-whisper-large-v3-turbo',
    sampleId: 'ru-5m',
    language: 'ru',
    durationBucket: '5m',
    modelVersion: 'fixture-model',
    runtime: 'Transformers.js',
    browser: 'fixture-browser',
    hardwareLane: 'recommended',
    durationSeconds: 300,
    fileType: 'audio/wav',
    modelDownloadBytes: 1,
    modelLoadSeconds: 1,
    realTimeFactor: 0.8,
    peakMemoryNotes: 'bounded test note',
    storageEstimateBefore: 100,
    storageEstimateAfter: 110,
    chunkCount: 10,
    completedChunkCount: 10,
    failedChunkCount: 0,
    reloadResumeResult: 'passed',
    transcriptQualityScore20: 15,
    subtitleUsefulnessScore20: 14,
    exportedFiles: OUTPUT_FILES,
    failureCode: null,
    humanNotes: 'fixture row',
    ...patch,
  }
}

test('builds the required P1 benchmark coverage matrix from the manifest', async () => {
  const manifest = await readManifest()
  const matrix = requiredBenchmarkMatrix(manifest)

  assert.equal(matrix.length, 27)
  assert.ok(matrix.some((item) => item.adapterId === 'sherpa-parakeet-v3-int8' && item.sampleId === 'mixed-60m'))
  assert.ok(matrix.some((item) => item.adapterId === 'sherpa-gigaam-russian' && item.sampleId === 'ru-30m'))
  assert.ok(matrix.some((item) => item.adapterId === 'transformers-whisper-large-v3-turbo' && item.sampleId === 'en-5m'))
})

test('validates benchmark rows before they can count as ASR evidence', async () => {
  const manifest = await readManifest()

  assert.deepEqual(validateBenchmarkRecord(validRecord(), manifest), [])

  const errors = validateBenchmarkRecord(validRecord({
    transcriptQualityScore20: 25,
    exportedFiles: ['transcript.md'],
    failureCode: 'made_up_failure',
  }), manifest)

  assert.ok(errors.some((error) => error.includes('transcriptQualityScore20')))
  assert.ok(errors.some((error) => error.includes('subtitles.srt')))
  assert.ok(errors.some((error) => error.includes('made_up_failure')))
})

test('keeps source media paths and raw transcript payloads out of benchmark ledgers', async () => {
  const manifest = await readManifest()
  const errors = validateBenchmarkRecord(validRecord({
    localPath: '/private/source/audio.wav',
    rawTranscript: 'full private transcript',
    humanNotes: 'See https://example.invalid/private-source-audio for details.',
  }), manifest)

  assert.ok(errors.some((error) => error.includes('localPath')))
  assert.ok(errors.some((error) => error.includes('rawTranscript')))
  assert.ok(errors.some((error) => error.includes('humanNotes contains a path-like private value')))
})

test('summarizes missing required coverage instead of treating partial runs as complete', async () => {
  const manifest = await readManifest()
  const summary = summarizeBenchmarkLedger([validRecord()], manifest)

  assert.equal(summary.status, 'incomplete')
  assert.equal(summary.validRowCount, 1)
  assert.equal(summary.requiredCaseCount, 27)
  assert.equal(summary.missingCases.length, 26)
})
