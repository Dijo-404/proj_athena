const AthenaFiller = (() => {
  const SUPPORTED_ACTIONS = new Set(["type", "select", "click", "upload"]);

  function fillField(payload) {
    const fieldLabel = normalizeText(payload.field_label || "");
    const value = payload.value ?? "";
    const action = SUPPORTED_ACTIONS.has(payload.action)
      ? payload.action
      : "type";

    if (!fieldLabel) {
      return { ok: false, error: "field_label is required." };
    }

    const element = findFieldByLabel(fieldLabel);

    if (!element) {
      return { ok: false, error: `Field not found: ${payload.field_label}` };
    }

    if (action === "upload") {
      return {
        ok: false,
        error:
          "Upload fields require manual input. Ask the user to attach the document.",
        manual_action_required: true,
      };
    }

    if (action === "click") {
      const tag = element.tagName.toLowerCase();
      if (tag === "select") {
        return {
          ok: false,
          error:
            "Use action=\"select\" for dropdowns, not action=\"click\".",
        };
      }
      if (element.disabled) {
        return { ok: false, error: "Element is disabled." };
      }
      element.click();
      return { ok: true, action: "click" };
    }

    if (action === "select") {
      const selected = selectOption(element, value);
      if (!selected) {
        return { ok: false, error: "Unable to select option." };
      }
      return { ok: true, action: "select" };
    }

    if (action === "type") {
      return setValue(element, value);
    }

    return { ok: false, error: "Unsupported action." };
  }

  function findFieldByLabel(label) {
    const candidates = [];

    document.querySelectorAll("label").forEach((labelEl) => {
      const labelText = normalizeText(labelEl.textContent || "");
      const score = scoreMatch(label, labelText);

      if (score <= 0) {
        return;
      }

      let field = null;
      const forId = labelEl.getAttribute("for");
      if (forId) {
        field = document.getElementById(forId);
      }
      if (!field) {
        field = labelEl.querySelector("input, select, textarea");
      }
      if (field) {
        candidates.push({ field, score: score + 2 });
      }
    });

    document.querySelectorAll("input, select, textarea").forEach((field) => {
      const fieldType = (field.getAttribute("type") || "").toLowerCase();
      if (fieldType === "hidden") {
        return;
      }
      const labelText = normalizeText(
        field.getAttribute("aria-label") ||
          field.getAttribute("placeholder") ||
          field.getAttribute("name") ||
          "",
      );
      const score = scoreMatch(label, labelText);
      if (score > 0) {
        candidates.push({ field, score });
      }
    });

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].field;
  }

  function setValue(element, value) {
    if (element.disabled) {
      return { ok: false, error: "Element is disabled." };
    }
    if (element.readOnly) {
      return { ok: false, error: "Element is read-only." };
    }
    const inputTypeAttr = (element.getAttribute("type") || "").toLowerCase();
    if (inputTypeAttr === "hidden") {
      return { ok: false, error: "Refusing to fill hidden input." };
    }
    if (element.offsetParent === null && inputTypeAttr !== "hidden") {
      return { ok: false, error: "Element is not visible." };
    }

    element.focus();

    const inputType = (element.getAttribute("type") || "").toLowerCase();
    if (inputType === "checkbox" || inputType === "radio") {
      element.checked = parseBoolean(value);
      dispatchInputEvents(element);
      return { ok: true, action: "type", checked: element.checked };
    }

    element.value = value;
    dispatchInputEvents(element);
    return { ok: true, action: "type" };
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ["true", "yes", "1", "on", "checked", "y"].includes(normalized);
  }

  function selectOption(element, value) {
    const tag = element.tagName.toLowerCase();
    if (tag !== "select") {
      return false;
    }

    const normalized = normalizeText(String(value));
    let bestOption = null;
    let bestScore = 0;

    for (const option of element.options) {
      const optionText = normalizeText(option.textContent || "");
      const score = scoreMatch(normalized, optionText);
      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }

    if (!bestOption) {
      return false;
    }

    element.value = bestOption.value;
    dispatchInputEvents(element);
    return true;
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeText(value) {
    const base = String(value);
    const normalized = base.normalize ? base.normalize("NFKC") : base;
    return normalized
      .toLowerCase()
      .replace(/[\s:]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim();
  }

  function scoreMatch(needle, haystack) {
    if (!needle || !haystack) {
      return 0;
    }

    if (needle === haystack) {
      return 3;
    }

    if (haystack.includes(needle) || needle.includes(haystack)) {
      return 2;
    }

    const needleTokens = new Set(needle.split(" ").filter(Boolean));
    const hayTokens = new Set(haystack.split(" ").filter(Boolean));
    let overlap = 0;

    needleTokens.forEach((token) => {
      if (hayTokens.has(token)) {
        overlap += 1;
      }
    });

    if (overlap >= Math.max(1, Math.floor(needleTokens.size / 2))) {
      return 1;
    }

    return 0;
  }

  return { fillField };
})();

self.AthenaFiller = AthenaFiller;
