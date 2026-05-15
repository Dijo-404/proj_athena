const DB_NAME = "AthenaDB";
const DB_VERSION = 1;

let dbPromise = null;
let seedPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("schemes")) {
        const schemes = db.createObjectStore("schemes", { keyPath: "id" });
        schemes.createIndex("caste", "eligibility.caste", { multiEntry: true });
        schemes.createIndex("income_limit", "eligibility.max_income");
        schemes.createIndex("deadline", "deadline");
      }
      if (!db.objectStoreNames.contains("applications")) {
        db.createObjectStore("applications", { keyPath: "scheme_id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function initDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

export function seedSchemesIfEmpty() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const db = await initDB();
      const count = await countStore(db, "schemes");
      if (count > 0) return { ok: true, count };

      const response = await fetch(chrome.runtime.getURL("data/schemes.json"));
      if (!response.ok) {
        return { ok: false, error: `Failed to load schemes: ${response.status}` };
      }
      const parsed = await response.json();
      const schemes = Array.isArray(parsed) ? parsed : [];
      await putMany(db, "schemes", schemes);
      return { ok: true, count: schemes.length };
    } catch (err) {
      seedPromise = null;
      return { ok: false, error: err?.message || "Seed failed" };
    }
  })();
  return seedPromise;
}

export async function getAllSchemes() {
  const db = await initDB();
  return getAll(db, "schemes");
}

export async function getSchemeById(id) {
  if (!id) return null;
  const db = await initDB();
  return getByKey(db, "schemes", id);
}

export async function listDbApplications() {
  const db = await initDB();
  return getAll(db, "applications");
}

export async function upsertDbApplication(entry) {
  const db = await initDB();
  const payload = { ...entry, updated_at: new Date().toISOString() };
  await putOne(db, "applications", payload);
  return payload;
}

function countStore(db, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly");
    const req = tx.objectStore(name).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly");
    const req = tx.objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getByKey(db, name, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly");
    const req = tx.objectStore(name).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function putMany(db, name, items) {
  return new Promise((resolve, reject) => {
    if (!items || items.length === 0) return resolve();
    const tx = db.transaction(name, "readwrite");
    const store = tx.objectStore(name);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function putOne(db, name, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readwrite");
    const req = tx.objectStore(name).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
