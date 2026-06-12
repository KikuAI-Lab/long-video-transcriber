export const MODEL_CANDIDATES = [
  {
    id: 'sherpa-parakeet-v3-int8',
    label: 'Parakeet TDT 0.6B V3 int8',
    runtime: 'sherpa-onnx',
    role: 'Primary RU+EN candidate',
    languages: ['English', 'Russian', 'Ukrainian'],
    route: 'WebAssembly first, browser cache required',
    compressedBytes: 487170055,
    license: 'CC-BY-4.0',
    sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html#sherpa-onnx-nemo-parakeet-tdt-0-6b-v3-int8-25-european-languages',
    concern: 'Large first-run download; benchmark must prove tab stability.',
  },
  {
    id: 'sherpa-gigaam-russian',
    label: 'GigaAM Russian',
    runtime: 'sherpa-onnx',
    role: 'Russian quality candidate',
    languages: ['Russian'],
    route: 'WebAssembly candidate after RU baseline',
    compressedBytes: 205384624,
    license: 'MIT upstream model family',
    sourceUrl: 'https://github.com/salute-developers/GigaAM',
    concern: 'RU-specific; needs separate EN path or language router.',
  },
  {
    id: 'transformers-whisper-large-v3-turbo',
    label: 'Whisper large-v3-turbo ONNX',
    runtime: 'Transformers.js',
    role: 'Multilingual browser baseline',
    languages: ['English', 'Russian', 'Multilingual'],
    route: 'WASM default; WebGPU when available',
    compressedBytes: null,
    license: 'Model license must be verified before paid use',
    sourceUrl: 'https://huggingface.co/onnx-community/whisper-large-v3-turbo',
    concern: 'Good compatibility baseline, but not the likely RU quality winner.',
  },
]

export const OUTPUT_FILES = [
  'transcript.md',
  'transcript.txt',
  'subtitles.srt',
  'subtitles.vtt',
  'qa-notes.md',
]

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unknown'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const rest = rounded % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${rest}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${rest}s`
  }
  return `${rest}s`
}

export function getFileProfile(file, durationSeconds = null) {
  if (!file) return null
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'unknown'

  return {
    name: file.name,
    extension,
    type: file.type || 'unknown',
    sizeBytes: file.size,
    sizeLabel: formatBytes(file.size),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
  }
}

export function estimateHardwareLane(capabilities) {
  const cores = normalizeNumber(capabilities.cores, 0)
  const memory = normalizeNumber(capabilities.memoryGb, 0)
  const benchmarkMs = normalizeNumber(capabilities.benchmarkMs, 0)
  const hasWebGpu = capabilities.webgpu === true
  const hasWasm = capabilities.webassembly === true
  const hasWorker = capabilities.worker === true
  const hasAudio = capabilities.audioContext === true
  const hasSharedArrayBuffer = capabilities.sharedArrayBuffer === true
  const hasCrossOriginIsolation = capabilities.crossOriginIsolated === true
  const blockers = []
  const strengths = []

  if (!hasWasm) blockers.push('WebAssembly is unavailable')
  if (!hasWorker) blockers.push('Web Workers are unavailable')
  if (!hasAudio) blockers.push('Browser audio decoding is unavailable')

  if (hasWebGpu) strengths.push('WebGPU available')
  if (cores >= 8) strengths.push(`${cores} CPU threads reported`)
  if (memory >= 16) strengths.push(`${memory} GB memory class reported`)
  if (hasSharedArrayBuffer && hasCrossOriginIsolation) strengths.push('Thread-friendly isolation available')
  if (benchmarkMs > 0 && benchmarkMs < 45) strengths.push('Fast CPU probe')

  if (blockers.length > 0) {
    return {
      lane: 'unsupported',
      label: 'Unsupported',
      score: 0,
      blockers,
      strengths,
      summary: 'This browser is missing a core local-ASR capability.',
    }
  }

  let score = 0
  if (hasWebGpu) score += 35
  if (cores >= 12) score += 25
  else if (cores >= 8) score += 18
  else if (cores >= 4) score += 9
  if (memory >= 32) score += 25
  else if (memory >= 16) score += 18
  else if (memory >= 8) score += 9
  if (hasSharedArrayBuffer && hasCrossOriginIsolation) score += 10
  if (benchmarkMs > 0) {
    if (benchmarkMs < 35) score += 15
    else if (benchmarkMs < 75) score += 8
  }

  if (score >= 70) {
    return {
      lane: 'recommended',
      label: 'Recommended',
      score,
      blockers,
      strengths,
      summary: 'Good candidate for browser-local long-file ASR tests.',
    }
  }

  if (score >= 35) {
    return {
      lane: 'slow',
      label: 'Slow but usable',
      score,
      blockers,
      strengths,
      summary: 'Use shorter chunks and expect longer processing time.',
    }
  }

  return {
    lane: 'limited',
    label: 'Limited',
    score,
    blockers,
    strengths,
    summary: 'Good enough for a smoke test, risky for long files.',
  }
}

export function buildBenchmarkRows(capabilities) {
  const lane = estimateHardwareLane(capabilities)

  return MODEL_CANDIDATES.map((candidate) => {
    let readiness = 'Benchmark required'
    if (candidate.id === 'sherpa-parakeet-v3-int8' && lane.lane === 'recommended') {
      readiness = 'First candidate'
    }
    if (candidate.id === 'sherpa-parakeet-v3-int8' && lane.lane !== 'recommended') {
      readiness = 'Try after small smoke test'
    }
    if (candidate.id === 'sherpa-gigaam-russian') {
      readiness = 'RU quality pass'
    }
    if (candidate.id === 'transformers-whisper-large-v3-turbo') {
      readiness = 'Browser baseline'
    }

    return {
      ...candidate,
      readiness,
      compressedLabel: formatBytes(candidate.compressedBytes),
    }
  })
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}
