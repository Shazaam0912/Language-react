// background.js — Service worker for Jisho dictionary lookups & STT streaming

let sttApiKey = "DEEPGRAM_OR_ASSEMBLYAI_KEY_PLACEHOLDER"; // Will be fetched from storage later
let originalTabId = null;

async function setupOffscreenDocument(path) {
  // Check all windows controlled by the service worker to see if one 
  // of them is the offscreen document with the given path
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create document
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab audio for Dual Subtitles transcription.'
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_LIVE_TRANSCRIPTION') {
    originalTabId = sender.tab.id;
    
    // We get the stream ID using the tabCapture API for the active tab
    chrome.tabCapture.getMediaStreamId({ targetTabId: originalTabId }, async (streamId) => {
      
      // Setup the offscreen document
      await setupOffscreenDocument('offscreen.html');

      // Send the stream ID to the offscreen document to start grabbing the PCM data
      chrome.runtime.sendMessage({
        type: 'START_CAPTURE',
        streamId: streamId,
        apiKey: sttApiKey
      });
      
      sendResponse({ status: "Transcription started" });
    });
    return true;
  }
  
  if (request.type === 'STOP_LIVE_TRANSCRIPTION') {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });
    sendResponse({ status: "Transcription stopped" });
    return true;
  }

  // Forward transcripts from offscreen document back precisely to the original content script
  if (request.type === 'STT_TRANSCRIPT' && originalTabId) {
    chrome.tabs.sendMessage(originalTabId, {
      type: 'INCOMING_LIVE_TRANSCRIPT',
      text: request.text,
      isFinal: request.isFinal
    });
  }

  if (request.type === 'JISHO_LOOKUP') {
    const word = request.word;
    fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`)
      .then(resp => resp.json())
      .then(data => {
        const meanings = [];
        let jlptLevel = null;

        if (data.data && data.data.length > 0) {
          const entry = data.data[0];

          // Extract JLPT level (e.g. ["jlpt-n5"] → "N5")
          if (entry.jlpt && entry.jlpt.length > 0) {
            const tag = entry.jlpt[0]; // e.g. "jlpt-n5"
            const match = tag.match(/jlpt-n(\d)/);
            if (match) jlptLevel = 'N' + match[1];
          }

          const senses = entry.senses.slice(0, 3);
          for (const sense of senses) {
            const pos = (sense.parts_of_speech && sense.parts_of_speech[0]) || '';
            const defs = (sense.english_definitions || []).slice(0, 3).join(', ');
            if (defs) {
              meanings.push({ pos, definition: defs });
            }
          }
        }
        sendResponse({ meanings, jlptLevel });
      })
      .catch(err => {
        console.error('[DUAL SUBS BG] Jisho error:', err);
        sendResponse({ meanings: [], jlptLevel: null });
      });
    return true;
  }
});
