chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "FILL_FIELD") {
    return;
  }

  const result = AthenaFiller.fillField(message.payload || {});
  sendResponse(result);
});
