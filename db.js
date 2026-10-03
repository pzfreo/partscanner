// Score library in IndexedDB: recognised MusicXML pages, the original photos
// (as Blobs) and practice settings, one record per score.

const DB_NAME = "partscanner";
const STORE = "scores";
const LEGACY_KEY = "partscanner.library.v1"; // localStorage, before photos were kept

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(migrateLegacy);
  return dbPromise;
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result.result ?? result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

async function migrateLegacy(db) {
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
  } catch {
    return db;
  }
  if (!Array.isArray(legacy)) return db;
  await run(db, "readwrite", (store) => {
    for (const entry of legacy) store.put({ images: [], ...entry });
    return {};
  });
  localStorage.removeItem(LEGACY_KEY);
  return db;
}

export async function all() {
  return run(await open(), "readonly", (store) => store.getAll());
}

export async function put(entry) {
  navigator.storage?.persist?.();
  return run(await open(), "readwrite", (store) => store.put(entry));
}

export async function update(id, changes) {
  const db = await open();
  return run(db, "readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => req.result && store.put({ ...req.result, ...changes });
    return {};
  });
}

export async function remove(id) {
  return run(await open(), "readwrite", (store) => store.delete(id));
}
