// background.js — Service worker for Jisho dictionary lookups
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
