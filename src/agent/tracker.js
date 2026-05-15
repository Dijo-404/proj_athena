import {
  listDbApplications,
  upsertDbApplication,
  getAllSchemes,
} from "../data/db.js";

const STORAGE_KEY = "applications";

export async function listApplications() {
  try {
    const [dbApps, storedMap, schemes] = await Promise.all([
      listDbApplications(),
      loadStoredApplications(),
      getAllSchemes(),
    ]);

    const mergedMap = { ...storedMap };
    for (const entry of dbApps) {
      if (entry?.scheme_id) mergedMap[entry.scheme_id] = entry;
    }
    await saveStoredApplications(mergedMap);

    const schemeMap = new Map((schemes || []).map((s) => [s.id, s]));
    const applications = Object.values(mergedMap)
      .map((entry) => attachScheme(entry, schemeMap))
      .sort(sortByDeadline);

    return { ok: true, applications };
  } catch (err) {
    return { ok: false, error: err?.message || "List failed." };
  }
}

export async function upsertApplication(payload) {
  if (!payload || !payload.scheme_id) {
    return { ok: false, error: "scheme_id is required" };
  }
  const entry = {
    scheme_id: String(payload.scheme_id),
    status: payload.status || "pending",
    notes: payload.notes || "",
    last_action: payload.last_action || "",
    updated_at: new Date().toISOString(),
  };
  try {
    await upsertDbApplication(entry);
    await saveStoredApplication(entry);
    return { ok: true, application: entry };
  } catch (err) {
    return { ok: false, error: err?.message || "Save failed." };
  }
}

function attachScheme(entry, schemeMap) {
  const scheme = schemeMap.get(entry.scheme_id);
  const deadline = scheme?.deadline || entry.deadline || null;
  return {
    ...entry,
    name: scheme?.name || entry.name || null,
    name_ta: scheme?.name_ta || entry.name_ta || null,
    amount: scheme?.amount || entry.amount || null,
    deadline,
    days_remaining: calculateDaysRemaining(deadline),
  };
}

function sortByDeadline(a, b) {
  const aDays = a.days_remaining ?? Number.POSITIVE_INFINITY;
  const bDays = b.days_remaining ?? Number.POSITIVE_INFINITY;
  if (aDays !== bDays) return aDays - bDays;
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}

function calculateDaysRemaining(deadline) {
  if (!deadline) return null;
  const parts = String(deadline).split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function loadStoredApplications() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result?.[STORAGE_KEY] || {});
    });
  });
}

function saveStoredApplications(map) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: map }, () => resolve());
  });
}

async function saveStoredApplication(entry) {
  const stored = await loadStoredApplications();
  stored[entry.scheme_id] = entry;
  return saveStoredApplications(stored);
}
