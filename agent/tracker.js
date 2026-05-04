const STORAGE_KEY = "applications";

const AthenaTracker = {
  async listApplications() {
    const [dbApplications, storedMap, schemes] = await Promise.all([
      AthenaDB.listApplications(),
      loadStoredApplications(),
      AthenaDB.getAllSchemes(),
    ]);

    const mergedMap = { ...storedMap };
    dbApplications.forEach((entry) => {
      if (entry && entry.scheme_id) {
        mergedMap[entry.scheme_id] = entry;
      }
    });

    await saveStoredApplications(mergedMap);

    const schemeMap = new Map(
      (schemes || []).map((scheme) => [scheme.id, scheme]),
    );

    const applications = Object.values(mergedMap)
      .map((entry) => attachScheme(entry, schemeMap))
      .sort(sortByDeadline);

    return { ok: true, applications };
  },

  async upsertApplication(payload) {
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

    await AthenaDB.upsertApplication(entry);
    const stored = await loadStoredApplications();
    stored[entry.scheme_id] = entry;
    await saveStoredApplications(stored);

    return { ok: true, application: entry };
  },
};

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
  if (aDays !== bDays) {
    return aDays - bDays;
  }
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}

function calculateDaysRemaining(deadline) {
  if (!deadline) {
    return null;
  }
  const parsed = parseDate(deadline);
  if (!parsed) {
    return null;
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const diffMs = parsed.getTime() - startOfToday.getTime();
  return Math.ceil(diffMs / 86400000);
}

function parseDate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
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

self.AthenaTracker = AthenaTracker;
