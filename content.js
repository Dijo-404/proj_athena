chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "FILL_FIELD") {
    return;
  }

  const result = AthenaFiller.fillField(message.payload || {});
  sendResponse(result);
});

const DOM_UPDATE_DEBOUNCE_MS = 1000;
let domUpdateTimer = null;
let lastDomContext = null;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDomObserver);
} else {
  initDomObserver();
}

function initDomObserver() {
  sendDomUpdate();

  if (!document.body) {
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleDomUpdate();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function scheduleDomUpdate() {
  if (domUpdateTimer) {
    clearTimeout(domUpdateTimer);
  }
  domUpdateTimer = setTimeout(sendDomUpdate, DOM_UPDATE_DEBOUNCE_MS);
}

function sendDomUpdate() {
  try {
    const context = readPageContext();
    // Only send if context actually changed
    const contextStr = JSON.stringify(context);
    if (contextStr === lastDomContext) {
      return;
    }
    lastDomContext = contextStr;

    chrome.runtime.sendMessage({
      type: "DOM_UPDATED",
      payload: context,
    });
  } catch (error) {
    // Ignore DOM update failures
  }
}

function readPageContext() {
  const labels = Array.from(document.querySelectorAll("label"))
    .map((label) => (label.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 12);

  return {
    url: window.location.href,
    title: document.title || "",
    forms: document.querySelectorAll("form").length,
    inputs: document.querySelectorAll("input").length,
    selects: document.querySelectorAll("select").length,
    textareas: document.querySelectorAll("textarea").length,
    labels,
  };
}
