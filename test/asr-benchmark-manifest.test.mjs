import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MODEL_CANDIDATES, OUTPUT_FILES } from '../src/lib/asr-candidates.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
}

test('ASR benchmark manifest covers current browser model candidates', async () => {
  const manifest = await readJson('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json')
  const adapterIds = new Set(manifest.adaptersUnderTest.map((adapter) => adapter.id))

  for (const candidate of MODEL_CANDIDATES) {
    assert.equal(adapterIds.has(candidate.id), true, `${candidate.id} is in the benchmark manifest`)
  }
})

test('ASR benchmark manifest defines 5/30/60 minute RU, EN, and mixed gates', async () => {
  const manifest = await readJson('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json')
  const requiredSamples = manifest.sampleMatrix.filter((sample) => sample.requiredForP1Benchmark)
  const sampleKeys = new Set(requiredSamples.map((sample) => `${sample.language}:${sample.durationBucket}`))

  for (const language of ['ru', 'en', 'mixed-ru-en']) {
    for (const duration of ['5m', '30m', '60m']) {
      assert.equal(sampleKeys.has(`${language}:${duration}`), true, `${language} ${duration} sample is required`)
    }
  }
})

test('ASR benchmark manifest protects export and pivot decisions', async () => {
  const manifest = await readJson('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json')

  assert.deepEqual(manifest.requiredExportFiles, OUTPUT_FILES)
  assert.ok(manifest.requiredMetrics.includes('realTimeFactor'))
  assert.ok(manifest.requiredMetrics.includes('reloadResumeResult'))
  assert.ok(manifest.requiredMetrics.includes('transcriptQualityScore20'))
  assert.ok(manifest.requiredMetrics.includes('subtitleUsefulnessScore20'))
  assert.ok(manifest.decisionGate.browserOnlyStaysIf.some((line) => line.includes('60-minute')))
  assert.ok(manifest.decisionGate.localHelperSpikeStartsIf.some((line) => line.includes('Browser-only ASR fails')))
  assert.equal(manifest.decisionGate.hostedAsrIsOnly, 'benchmark_oracle_or_explicit_opt_in_mode_before_privacy_positioning_changes')
})
