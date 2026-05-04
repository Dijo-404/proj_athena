chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "FILL_FIELD") {
    return;
  }

  const result = AthenaFiller.fillField(message.payload || {});
  sendResponse(result);
});

const DOM_UPDATE_DEBOUNCE_MS = 600;
let domUpdateTimer = null;

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
    chrome.runtime.sendMessage({
      type: "DOM_UPDATED",
      payload: readPageContext(),
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
