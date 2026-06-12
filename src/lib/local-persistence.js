const DATABASE_NAME = 'long-video-transcriber'
const STORE_NAME = 'projects'

export function detectPersistenceFeatures() {
  return {
    indexedDB: typeof window.indexedDB !== 'undefined',
    opfs: Boolean(navigator.storage?.getDirectory),
    storageEstimate: Boolean(navigator.storage?.estimate),
  }
}

export async function persistProjectSnapshot(snapshot) {
  if (!snapshot?.project?.projectId || typeof window.indexedDB === 'undefined') {
    return 'Snapshot kept in memory only'
  }

  const plainSnapshot = JSON.parse(JSON.stringify(snapshot))
  await saveSnapshotToIndexedDb(plainSnapshot)

  if (navigator.storage?.getDirectory) {
    await saveSnapshotToOpfs(plainSnapshot)
    return 'Saved to IndexedDB and OPFS'
  }

  return 'Saved to IndexedDB'
}

function saveSnapshotToIndexedDb(snapshot) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const write = store.put({
        id: snapshot.project.projectId,
        snapshot,
        updatedAt: snapshot.updatedAt,
      })
      write.onerror = () => reject(write.error || new Error('Unable to save snapshot'))
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error || new Error('Unable to save snapshot'))
      }
    }
  })
}

async function saveSnapshotToOpfs(snapshot) {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle('long-video-transcriber', { create: true })
  const fileHandle = await directory.getFileHandle(`${snapshot.project.projectId}.json`, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(snapshot, null, 2))
  await writable.close()
}
