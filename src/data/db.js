const AthenaDB = (() => {
  const DB_NAME = "AthenaDB";
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("schemes")) {
          const schemesStore = db.createObjectStore("schemes", {
            keyPath: "id",
          });
          schemesStore.createIndex("caste", "eligibility.caste", {
            multiEntry: true,
          });
          schemesStore.createIndex("income_limit", "eligibility.max_income");
          schemesStore.createIndex("deadline", "deadline");
        }

        if (!db.objectStoreNames.contains("applications")) {
          db.createObjectStore("applications", { keyPath: "scheme_id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function initDB() {
    if (!dbPromise) {
      dbPromise = openDB();
    }
    return dbPromise;
  }

  async function seedSchemesIfEmpty() {
    const db = await initDB();
    const count = await countStore(db, "schemes");

    if (count > 0) {
      return { ok: true, count };
    }

    const response = await fetch(chrome.runtime.getURL("data/schemes.json"));
    if (!response.ok) {
      return { ok: false, error: `Failed to load schemes: ${response.status}` };
    }

    const parsed = await response.json();
    const schemes = Array.isArray(parsed) ? parsed : [];
    await putMany(db, "schemes", schemes);

    return { ok: true, count: schemes.length };
  }

  async function getAllSchemes() {
    const db = await initDB();
    return getAll(db, "schemes");
  }

  async function getSchemeById(id) {
    if (!id) {
      return null;
    }
    const db = await initDB();
    return getByKey(db, "schemes", id);
  }

  async function listApplications() {
    const db = await initDB();
    return getAll(db, "applications");
  }

  async function upsertApplication(entry) {
    const db = await initDB();
    const payload = {
      ...entry,
      updated_at: new Date().toISOString(),
    };
    await putOne(db, "applications", payload);
    return payload;
  }

  function countStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  }

  function getAll(db, storeName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function getByKey(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function putMany(db, storeName, items) {
    return new Promise((resolve, reject) => {
      if (!items || items.length === 0) {
        resolve();
        return;
      }

      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);

      items.forEach((item) => store.put(item));

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function putOne(db, storeName, item) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  return {
    initDB,
    seedSchemesIfEmpty,
    getAllSchemes,
    getSchemeById,
    listApplications,
    upsertApplication,
  };
})();

self.AthenaDB = AthenaDB;
window.AthenaDB = AthenaDB;
