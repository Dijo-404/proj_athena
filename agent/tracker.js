const AthenaTracker = {
  async listApplications() {
    const applications = await AthenaDB.listApplications();
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

    const saved = await AthenaDB.upsertApplication(entry);
    return { ok: true, application: saved };
  },
};

self.AthenaTracker = AthenaTracker;
