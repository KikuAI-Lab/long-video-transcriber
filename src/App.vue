<template>
  <main class="app-shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Browser-local ASR</p>
        <h1>Long Video Transcriber</h1>
        <p class="lead">
          Build a local transcript package from user-owned audio or video. Source media is decoded and transcribed in the browser.
        </p>
      </div>
      <div class="status-grid" aria-label="Current readiness">
        <div class="metric">
          <span>Device</span>
          <strong>{{ hardwareLane.label }}</strong>
        </div>
        <div class="metric">
          <span>Chunks</span>
          <strong>{{ chunkPlanSummary }}</strong>
        </div>
        <div class="metric">
          <span>Export</span>
          <strong>{{ exportReadyLabel }}</strong>
        </div>
      </div>
    </section>

    <section class="workbench">
      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <input
          ref="uploadInput"
          accept="video/*,audio/*,.mp4,.mov,.mkv,.m4v,.webm,.mp3,.wav,.m4a"
          hidden
          type="file"
          @change="handleFilePick"
        >
        <button class="drop-button" type="button" @click="openFilePicker">
          <span>{{ selectedFile ? 'Replace media file' : 'Choose audio or video' }}</span>
          <small>MP4, M4A, WAV, WebM, MP3, MOV</small>
        </button>

        <dl v-if="fileProfile" class="details">
          <div>
            <dt>Name</dt>
            <dd>{{ fileProfile.name }}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{{ fileProfile.sizeLabel }}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{{ fileProfile.durationLabel }}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{{ fileProfile.type }}</dd>
          </div>
        </dl>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Hardware gate</p>
            <h2>{{ hardwareLane.label }}</h2>
          </div>
          <button class="secondary" type="button" @click="runCpuProbe">CPU probe</button>
        </div>
        <p class="muted">{{ hardwareLane.summary }}</p>
        <div class="mini-grid">
          <div v-for="metric in hardwareMetrics" :key="metric.label" class="mini">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="workbench">
      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Local project</p>
            <h2>Checkpointed chunk run</h2>
          </div>
          <span class="pill">{{ runnerSummary.status }}</span>
        </div>
        <dl class="details">
          <div>
            <dt>Project</dt>
            <dd>{{ localProject?.projectId || 'No file selected' }}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{{ persistenceStatus }}</dd>
          </div>
          <div>
            <dt>Extraction</dt>
            <dd>{{ mediaExtractionSummary }}</dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>{{ runnerProgressLabel }}</dd>
          </div>
        </dl>
        <div class="actions">
          <button class="secondary" type="button" :disabled="!mediaExtractionCanRun" @click="testMediaExtraction">
            Test extraction
          </button>
          <button class="primary" type="button" :disabled="!chunkRunnerCanRun" @click="runChunkPlan">
            {{ chunkRunnerBusy ? 'Running...' : 'Run chunks' }}
          </button>
          <button class="secondary" type="button" :disabled="!chunkRunnerBusy" @click="cancelChunkRun">
            Cancel
          </button>
          <button class="secondary" type="button" :disabled="!chunkRunnerCanRetry" @click="retryFailedChunks">
            Retry failed
          </button>
        </div>
        <p class="status-line">{{ chunkRunnerStatusMessage }}</p>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Export</p>
            <h2>Transcript package</h2>
          </div>
          <button class="primary" type="button" :disabled="!chunkRunnerCanExport" @click="downloadProjectZip">
            Download ZIP
          </button>
        </div>
        <div class="package-grid">
          <div v-for="file in exportPreviewRows" :key="file.name" class="package-file">
            <strong>{{ file.name }}</strong>
            <span>{{ file.summary }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel models">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Model candidates</p>
          <h2>RU+EN first, measured before claims</h2>
        </div>
        <span class="pill">{{ localEventCount }} local events</span>
      </div>
      <div class="model-grid">
        <article v-for="candidate in modelRows" :key="candidate.id" class="model-card">
          <span class="pill">{{ candidate.readiness }}</span>
          <h3>{{ candidate.label }}</h3>
          <p>{{ candidate.role }}</p>
          <dl class="model-meta">
            <div>
              <dt>Runtime</dt>
              <dd>{{ candidate.runtime }}</dd>
            </div>
            <div>
              <dt>Download</dt>
              <dd>{{ candidate.compressedLabel }}</dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>{{ candidate.license }}</dd>
            </div>
          </dl>
          <a :href="candidate.sourceUrl" target="_blank" rel="noreferrer">Source</a>
        </article>
      </div>
    </section>

    <section class="panel transcript-preview">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Preview</p>
          <h2>Transcript output</h2>
        </div>
        <span class="pill">{{ transcriptSegments.length }} segments</span>
      </div>
      <pre>{{ transcriptPreview }}</pre>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  buildBenchmarkRows,
  estimateHardwareLane,
  getFileProfile,
  OUTPUT_FILES,
} from './lib/asr-candidates.js'
import {
  buildExportPackage,
  buildExportZipArchive,
  buildPersistencePlan,
  cancelRunner,
  completeRunnerChunk,
  createChunkManifest,
  createChunkRunnerState,
  createProjectManifest,
  createProjectSnapshot,
  failRunnerChunk,
  getRunnerSummary,
  normalizeAsrSegments,
  retryFailedRunnerChunks as resetFailedRunnerChunks,
  startNextRunnerChunk,
} from './lib/local-transcript-project.js'
import {
  decodeMediaAudioBuffer,
  encodeAudioBufferChunkAsWav,
  readMediaDuration,
} from './lib/browser-media.js'
import {
  bucketBytes,
  bucketDuration,
  createLocalEvent,
  readLocalEvents,
  recordLocalEvent,
} from './lib/local-events.js'
import {
  detectPersistenceFeatures,
  persistProjectSnapshot,
} from './lib/local-persistence.js'

const uploadInput = ref(null)
const selectedFile = ref(null)
const fileDurationSeconds = ref(null)
const isDragging = ref(false)
const cpuProbeMs = ref(0)
const localProject = ref(null)
const chunkManifest = ref(null)
const chunkRunner = ref(null)
const chunkRunnerAbortRequested = ref(false)
const chunkRunnerStatusMessage = ref('Choose a media file to create a local project.')
const mediaExtraction = ref({
  status: 'idle',
  adapterId: 'none',
  message: 'Choose a file first',
  decodedDurationSeconds: null,
  sampleRate: null,
  channelCount: null,
  elapsedMs: 0,
  audioBuffer: null,
})
const persistenceFeatures = ref({
  indexedDB: false,
  opfs: false,
  storageEstimate: false,
})
const persistenceStatus = ref('Not checked')
const transcriptSegments = ref([])
const exportPackage = ref(buildExportPackage(null, []))
const localEventCount = ref(0)
const capabilities = ref({
  cores: 0,
  memoryGb: 0,
  webgpu: false,
  webassembly: false,
  worker: false,
  audioContext: false,
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  benchmarkMs: 0,
})
let chunkTranscriberPromise = null

const fileProfile = computed(() => getFileProfile(selectedFile.value, fileDurationSeconds.value))
const hardwareLane = computed(() => estimateHardwareLane(capabilities.value))
const modelRows = computed(() => buildBenchmarkRows(capabilities.value))
const runnerSummary = computed(() => getRunnerSummary(chunkRunner.value))
const chunkRunnerBusy = computed(() => runnerSummary.value.status === 'running')
const chunkRunnerCanRun = computed(() => Boolean(
  selectedFile.value
  && chunkRunner.value
  && runnerSummary.value.pending > 0
  && !chunkRunnerBusy.value
))
const chunkRunnerCanRetry = computed(() => Boolean(chunkRunner.value && runnerSummary.value.failed > 0 && !chunkRunnerBusy.value))
const chunkRunnerCanExport = computed(() => Boolean(
  localProject.value
  && Object.values(exportPackage.value || {}).some((content) => typeof content === 'string' && content.length > 0)
))
const mediaExtractionCanRun = computed(() => Boolean(
  selectedFile.value
  && !chunkRunnerBusy.value
  && mediaExtraction.value.status !== 'running'
))
const hardwareMetrics = computed(() => [
  { label: 'WebGPU', value: capabilities.value.webgpu ? 'Available' : 'Not detected' },
  { label: 'CPU threads', value: capabilities.value.cores ? String(capabilities.value.cores) : 'Unknown' },
  { label: 'Memory class', value: capabilities.value.memoryGb ? `${capabilities.value.memoryGb} GB` : 'Unknown' },
  { label: 'Workers', value: capabilities.value.worker ? 'Available' : 'Unavailable' },
  { label: 'Isolation', value: capabilities.value.crossOriginIsolated ? 'Ready' : 'Not isolated' },
  { label: 'CPU probe', value: capabilities.value.benchmarkMs ? `${capabilities.value.benchmarkMs.toFixed(1)} ms` : 'Not run' },
])
const chunkPlanSummary = computed(() => {
  const chunks = chunkManifest.value?.chunks || []
  if (!selectedFile.value) return 'No file'
  if (chunks.length === 0) return 'No duration'
  return `${chunks.length}`
})
const runnerProgressLabel = computed(() => {
  const summary = runnerSummary.value
  if (!chunkRunner.value) return 'No checkpoint'
  return `${summary.done}/${summary.total} chunks, ${summary.segmentCount} segments`
})
const mediaExtractionSummary = computed(() => {
  if (!selectedFile.value) return 'No source selected'
  if (mediaExtraction.value.status === 'ready') {
    const duration = Math.round(mediaExtraction.value.decodedDurationSeconds || 0)
    return `${mediaExtraction.value.adapterId}, ${duration}s decoded`
  }
  if (mediaExtraction.value.status === 'failed') return mediaExtraction.value.message
  if (mediaExtraction.value.status === 'running') return 'Decoding locally'
  return selectedFile.value.type.startsWith('video/')
    ? 'Native browser video-audio decode'
    : 'Native browser audio decode'
})
const exportReadyLabel = computed(() => transcriptSegments.value.length > 0 ? 'Ready' : 'Draft')
const exportPreviewRows = computed(() => OUTPUT_FILES.map((fileName) => {
  const content = exportPackage.value[fileName] || ''
  return {
    name: fileName,
    summary: content ? `${content.length} chars` : 'Waiting for segments',
  }
}))
const transcriptPreview = computed(() => {
  const text = exportPackage.value['transcript.txt'] || ''
  return text || 'No transcript segments yet.'
})

onMounted(() => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  persistenceFeatures.value = detectPersistenceFeatures()
  capabilities.value = {
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: navigator.deviceMemory || 0,
    webgpu: Boolean(navigator.gpu),
    webassembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
    audioContext: Boolean(AudioContextClass),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: window.crossOriginIsolated === true,
    benchmarkMs: cpuProbeMs.value,
  }
  persistenceStatus.value = buildPersistencePlan(persistenceFeatures.value).summary
  recordEvent('hardware_profile_checked', {
    funnelStep: 'readiness',
    outcome: hardwareLane.value.lane,
    metrics: {
      cores: capabilities.value.cores,
      memoryGb: capabilities.value.memoryGb,
    },
  })
})

function openFilePicker() {
  uploadInput.value?.click()
}

function handleFilePick() {
  const file = uploadInput.value?.files?.item(0)
  if (file) selectFile(file)
}

function handleDrop(event) {
  isDragging.value = false
  const file = event.dataTransfer?.files.item(0)
  if (file) selectFile(file)
}

async function selectFile(file) {
  selectedFile.value = file
  fileDurationSeconds.value = null
  localProject.value = null
  chunkManifest.value = null
  chunkRunner.value = null
  transcriptSegments.value = []
  exportPackage.value = buildExportPackage(null, [])
  chunkRunnerStatusMessage.value = 'Reading local media metadata.'
  mediaExtraction.value = {
    status: 'idle',
    adapterId: 'native-decode-audio',
    message: 'Waiting for extraction',
    decodedDurationSeconds: null,
    sampleRate: null,
    channelCount: null,
    elapsedMs: 0,
    audioBuffer: null,
  }
  recordEvent('input_selected', {
    funnelStep: 'input',
    outcome: mediaKind(),
    metrics: {
      fileSizeBucket: bucketBytes(file.size),
    },
    properties: {
      mimeType: file.type || 'unknown',
    },
  })

  try {
    fileDurationSeconds.value = await readMediaDuration(file)
  } catch {
    fileDurationSeconds.value = null
  }

  await rebuildLocalProject()
}

function runCpuProbe() {
  const started = performance.now()
  let value = 0
  for (let index = 0; index < 900000; index += 1) {
    value += Math.sqrt(index + (value % 7))
  }
  cpuProbeMs.value = performance.now() - started
  capabilities.value = {
    ...capabilities.value,
    benchmarkMs: cpuProbeMs.value,
  }
  recordEvent('cpu_probe_completed', {
    funnelStep: 'readiness',
    outcome: hardwareLane.value.lane,
    metrics: {
      probeDurationBucket: bucketDuration(cpuProbeMs.value),
    },
  })
  if (selectedFile.value) rebuildLocalProject()
  if (value < 0) chunkRunnerStatusMessage.value = String(value)
}

async function testMediaExtraction() {
  if (!selectedFile.value) return
  const started = performance.now()
  mediaExtraction.value = {
    ...mediaExtraction.value,
    status: 'running',
    message: 'Decoding media audio locally',
    elapsedMs: 0,
    audioBuffer: null,
  }

  try {
    const decodedMedia = await decodeMediaAudioBuffer(selectedFile.value)
    setMediaExtractionReady({
      ...decodedMedia,
      elapsedMs: performance.now() - started,
    })
    chunkRunnerStatusMessage.value = 'Media extraction passed. Run chunks when ready.'
    recordEvent('media_extraction_completed', {
      funnelStep: 'extraction',
      outcome: decodedMedia.adapterId,
      metrics: {
        durationSeconds: Math.round(decodedMedia.durationSeconds || 0),
        extractionTimeBucket: bucketDuration(performance.now() - started),
      },
      properties: {
        mediaKind: mediaKind(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Media extraction failed.'
    mediaExtraction.value = {
      ...mediaExtraction.value,
      status: 'failed',
      message,
      elapsedMs: performance.now() - started,
      audioBuffer: null,
    }
    chunkRunnerStatusMessage.value = message
    recordEvent('media_extraction_failed', {
      funnelStep: 'extraction',
      outcome: 'error',
    })
  }
}

async function runChunkPlan() {
  if (!selectedFile.value || !chunkRunner.value) return
  const started = performance.now()
  chunkRunnerAbortRequested.value = false
  recordEvent('chunk_run_started', {
    funnelStep: 'chunk_runner',
    outcome: mediaKind(),
    metrics: chunkMetricSummary(),
  })

  try {
    if (!mediaExtraction.value.audioBuffer) {
      await testMediaExtraction()
    }
    if (!mediaExtraction.value.audioBuffer) {
      throw new Error('No decoded audio buffer is available.')
    }

    chunkRunnerStatusMessage.value = 'Loading local browser ASR adapter.'
    const transcriber = await loadChunkTranscriber()

    while (runnerSummary.value.pending > 0) {
      if (chunkRunnerAbortRequested.value) {
        chunkRunner.value = cancelRunner(chunkRunner.value)
        chunkRunnerStatusMessage.value = 'Chunk run canceled.'
        break
      }

      chunkRunner.value = startNextRunnerChunk(chunkRunner.value)
      const activeChunkId = chunkRunner.value.activeChunkId
      const activeChunk = chunkRunner.value.chunks.find((chunk) => chunk.id === activeChunkId)
      if (!activeChunk) break

      chunkRunnerStatusMessage.value = `Transcribing ${activeChunk.id}.`
      await saveSnapshot('chunk-running')

      let objectUrl = ''
      try {
        const chunkBlob = encodeAudioBufferChunkAsWav(mediaExtraction.value.audioBuffer, activeChunk)
        objectUrl = URL.createObjectURL(chunkBlob)
        const result = await transcriber(objectUrl, {
          return_timestamps: true,
        })
        chunkRunner.value = completeRunnerChunk(chunkRunner.value, activeChunk.id, result, {
          engineId: localProject.value?.selectedAdapterId || 'transformers-whisper-large-v3-turbo',
        })
        transcriptSegments.value = chunkRunner.value.segments
        refreshExportPackage()
        await saveSnapshot(chunkRunner.value.status === 'completed' ? 'chunk-runner-complete' : 'chunk-runner-checkpoint')
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      }
    }

    if (runnerSummary.value.status === 'completed') {
      chunkRunnerStatusMessage.value = 'Chunk run complete. ZIP export is ready.'
      recordEvent('chunk_run_completed', {
        funnelStep: 'chunk_runner',
        outcome: 'completed',
        metrics: {
          runtimeBucket: bucketDuration(performance.now() - started),
          ...chunkMetricSummary(),
        },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chunk runner failed.'
    const activeChunkId = chunkRunner.value?.activeChunkId || runnerSummary.value.nextChunk?.id || 'source'
    chunkRunner.value = failRunnerChunk(chunkRunner.value, activeChunkId, message)
    chunkRunnerStatusMessage.value = message
    await saveSnapshot('chunk-runner-failed')
    recordEvent('chunk_run_failed', {
      funnelStep: 'chunk_runner',
      outcome: 'error',
    })
  }
}

function cancelChunkRun() {
  chunkRunnerAbortRequested.value = true
  chunkRunnerStatusMessage.value = 'Cancel requested. The browser stops after the active model call returns.'
}

async function retryFailedChunks() {
  if (!chunkRunner.value) return
  chunkRunner.value = resetFailedRunnerChunks(chunkRunner.value)
  chunkRunnerStatusMessage.value = 'Failed chunks are queued for another local run.'
  await saveSnapshot('chunk-runner-retry-queued')
}

function downloadProjectZip() {
  refreshExportPackage()
  const archive = buildExportZipArchive(exportPackage.value)
  const blob = new Blob([archive], { type: 'application/zip' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `${sanitizeDownloadName(localProject.value?.file?.name || 'long-video-transcriber')}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  recordEvent('package_downloaded', {
    funnelStep: 'export',
    outcome: 'zip',
    metrics: {
      outputSizeBucket: bucketBytes(archive.length),
      ...chunkMetricSummary(),
    },
  })
}

async function loadChunkTranscriber() {
  if (chunkTranscriberPromise) return chunkTranscriberPromise
  chunkTranscriberPromise = (async () => {
    const module = await import('@huggingface/transformers')
    if (module.env) {
      module.env.allowLocalModels = false
      module.env.allowRemoteModels = true
    }
    const pipelineOptions = capabilities.value.webgpu
      ? { dtype: 'q4', device: 'webgpu' }
      : { dtype: 'q8' }
    return module.pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-large-v3-turbo',
      pipelineOptions
    )
  })()
  return chunkTranscriberPromise
}

async function rebuildLocalProject() {
  const profile = getFileProfile(selectedFile.value, fileDurationSeconds.value)
  if (!profile) return

  localProject.value = createProjectManifest({
    fileProfile: profile,
    hardwareLane: hardwareLane.value,
    capabilities: capabilities.value,
  })
  chunkManifest.value = createChunkManifest(profile)
  chunkRunner.value = createChunkRunnerState(chunkManifest.value, {
    engineId: localProject.value.selectedAdapterId,
    segments: transcriptSegments.value,
  })
  refreshExportPackage()
  chunkRunnerStatusMessage.value = selectedFile.value?.type.startsWith('video/')
    ? 'Ready to try native browser video-audio extraction.'
    : 'Ready to run browser-local audio chunks.'
  await saveSnapshot('project-created')
}

function setMediaExtractionReady(decodedMedia) {
  mediaExtraction.value = {
    status: 'ready',
    adapterId: decodedMedia.adapterId,
    message: 'Audio decoded locally',
    decodedDurationSeconds: decodedMedia.durationSeconds,
    sampleRate: decodedMedia.sampleRate,
    channelCount: decodedMedia.channelCount,
    elapsedMs: decodedMedia.elapsedMs || mediaExtraction.value.elapsedMs || 0,
    audioBuffer: decodedMedia.audioBuffer,
  }
}

function refreshExportPackage() {
  exportPackage.value = buildExportPackage(localProject.value, transcriptSegments.value, { chunkManifest: chunkManifest.value })
}

async function saveSnapshot(status) {
  if (!localProject.value) return
  try {
    persistenceStatus.value = await persistProjectSnapshot(createProjectSnapshot(
      localProject.value,
      chunkManifest.value,
      transcriptSegments.value,
      {
        runnerState: chunkRunner.value,
        status,
      }
    ))
  } catch (error) {
    persistenceStatus.value = error instanceof Error ? `Local snapshot failed: ${error.message}` : 'Local snapshot failed'
  }
}

function recordEvent(event, options) {
  const recorded = recordLocalEvent(createLocalEvent({ event, ...options }))
  localEventCount.value = readLocalEvents().length
  return recorded
}

function mediaKind() {
  if (!selectedFile.value) return 'unknown'
  if (selectedFile.value.type.startsWith('audio/')) return 'audio'
  if (selectedFile.value.type.startsWith('video/')) return 'video'
  return 'unknown'
}

function chunkMetricSummary() {
  const summary = runnerSummary.value
  return {
    chunkCount: summary.total,
    completedChunkCount: summary.done,
    failedChunkCount: summary.failed,
    segmentCount: summary.segmentCount,
  }
}

function sanitizeDownloadName(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'long-video-transcriber'
}
</script>
