import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  summarizeCorpusReadiness,
  validateCorpusManifest,
} from '../src/lib/asr-benchmark-corpus.js'

const benchmarkManifest = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-manifest-2026-06-18.json', 'utf8'))
const corpusTemplate = JSON.parse(await readFile('docs/benchmarks/asr-benchmark-corpus.p2.template.json', 'utf8'))

test('P2 corpus template covers every required benchmark sample but remains blocked until approvals', () => {
  assert.deepEqual(validateCorpusManifest(corpusTemplate, benchmarkManifest), [])

  const summary = summarizeCorpusReadiness(corpusTemplate, benchmarkManifest)

  assert.equal(summary.status, 'blocked')
  assert.equal(summary.requiredSampleCount, 9)
  assert.equal(summary.observedSampleCount, 9)
  assert.equal(summary.approvedSampleCount, 0)
  assert.equal(summary.oracleReadySampleCount, 0)
  assert.equal(summary.blockedReasons.length, 18)
})

test('approved corpus can become ready without storing source media details', () => {
  const readyCorpus = {
    ...corpusTemplate,
    samples: corpusTemplate.samples.map((sample) => ({
      ...sample,
      consentStatus: 'approved',
      transcriptOracleStatus: 'ready',
    })),
  }

  assert.deepEqual(summarizeCorpusReadiness(readyCorpus, benchmarkManifest), {
    status: 'ready',
    requiredSampleCount: 9,
    observedSampleCount: 9,
    approvedSampleCount: 9,
    oracleReadySampleCount: 9,
    blockedReasons: [],
  })
})

test('corpus manifest rejects local paths, media URLs, raw transcript text and extra fields', () => {
  const invalidCorpus = {
    ...corpusTemplate,
    samples: [
      {
        ...corpusTemplate.samples[0],
        localPath: '/private/local-video.mp4',
        transcriptText: 'raw private transcript',
        mediaUrl: 'file:///private/video.mp4',
        notes: 'External media lives at https://example.invalid/private-video.mp4',
        unexpected: 'not allowed',
      },
      ...corpusTemplate.samples.slice(1),
    ],
  }

  const errors = validateCorpusManifest(invalidCorpus, benchmarkManifest)

  assert.ok(errors.includes('samples[0].localPath is not allowed in corpus manifests'))
  assert.ok(errors.includes('samples[0].transcriptText is not allowed in corpus manifests'))
  assert.ok(errors.includes('samples[0].mediaUrl is not allowed in corpus manifests'))
  assert.ok(errors.includes('samples[0].notes contains a path-like private value'))
  assert.ok(errors.includes('samples[0].unexpected is not an allowed corpus field'))
})

test('corpus manifest rejects missing, duplicate and mismatched samples', () => {
  const invalidCorpus = {
    ...corpusTemplate,
    samples: [
      { ...corpusTemplate.samples[0], id: 'ru-5m', language: 'en' },
      ...corpusTemplate.samples.slice(1, 8),
      { ...corpusTemplate.samples[8], id: 'ru-5m' },
    ],
  }

  const errors = validateCorpusManifest(invalidCorpus, benchmarkManifest)

  assert.ok(errors.includes('samples[0].language en does not match ru-5m'))
  assert.ok(errors.includes('samples[8].id ru-5m is duplicated'))
  assert.ok(errors.includes('required sample mixed-60m is missing from corpus manifest'))
})
