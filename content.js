// content.js
(function () {
  const isMobile = location.href.startsWith("https://m.youtube.com");
  let fired = false;
  let currentVideoID = extractYouTubeVideoID();
  let animFrameId = null;

  // --- SETTINGS (with defaults, to be overwritten by storage) ---
  let settings = {
    originalLangs: ["es", "de", "ru", "ua", "zh"],
    targetLang: "en",
    autoPlay: true,
    showRomaji: true,
  };

  // ── Word Save System State ────────────────────────────────────────
  let savedWords = {}; // key → 'known'|'remember'|'unknown'

  const SAVE_STATES = ['known', 'remember', 'unknown'];
  const SAVE_COLORS = {
    known:    { bg: 'rgba(34,197,94,0.15)',  border: '#22c55e', text: '#22c55e',  label: '✓ Known' },
    remember: { bg: 'rgba(234,179,8,0.15)', border: '#eab308', text: '#eab308', label: '★ Remember' },
    unknown:  { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.2)', text: '#e0e0e0', label: '? Unknown' }
  };

  // Load saved words from storage immediately
  chrome.storage.local.get('dsSavedWords', (result) => {
    savedWords = result.dsSavedWords || {};
  });
  // ──────────────────────────────────────────────────────────────────

  // --- KUROMOJI TOKENIZER (loaded once) ---
  let kuromojiTokenizer = null;
  let kuromojiLoading = false;

  // --- KATAKANA TO ROMAJI MAP ---
  const KATAKANA_ROMAJI = {
    'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
    'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
    'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
    'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
    'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
    'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
    'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
    'ヤ':'ya','ユ':'yu','ヨ':'yo',
    'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
    'ワ':'wa','ヲ':'wo','ン':'n',
    'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
    'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
    'ダ':'da','ヂ':'di','ヅ':'du','デ':'de','ド':'do',
    'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
    'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
    'キャ':'kya','キュ':'kyu','キョ':'kyo',
    'シャ':'sha','シュ':'shu','ショ':'sho',
    'チャ':'cha','チュ':'chu','チョ':'cho',
    'ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
    'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo',
    'ミャ':'mya','ミュ':'myu','ミョ':'myo',
    'リャ':'rya','リュ':'ryu','リョ':'ryo',
    'ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
    'ジャ':'ja','ジュ':'ju','ジョ':'jo',
    'ビャ':'bya','ビュ':'byu','ビョ':'byo',
    'ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
    'ッ':'', // double consonant marker — handled separately
    'ー':'',  // long vowel mark
    'ヴ':'vu',
    'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo',
    'ティ':'ti','ディ':'di',
    'デュ':'dyu','トゥ':'tu',
    'ウィ':'wi','ウェ':'we','ウォ':'wo',
  };

  // Hiragana to romaji (same mapping but for hiragana codepoints)
  const HIRAGANA_ROMAJI = {};
  for (const [kata, romaji] of Object.entries(KATAKANA_ROMAJI)) {
    // Convert katakana char to hiragana (katakana codepoint - 0x60 = hiragana codepoint)
    const hira = kata.split('').map(c => {
      const code = c.charCodeAt(0);
      if (code >= 0x30A1 && code <= 0x30F6) return String.fromCharCode(code - 0x60);
      if (code === 0x30FC) return 'ー';
      if (code === 0x30C3) return 'っ';
      return c;
    }).join('');
    HIRAGANA_ROMAJI[hira] = romaji;
  }

  function katakanaToRomaji(katakanaStr) {
    if (!katakanaStr) return '';
    let result = '';
    let i = 0;
    while (i < katakanaStr.length) {
      // Try 2-char match first (for combo kana like シャ)
      if (i + 1 < katakanaStr.length) {
        const twoChar = katakanaStr.substring(i, i + 2);
        if (KATAKANA_ROMAJI[twoChar] !== undefined) {
          result += KATAKANA_ROMAJI[twoChar];
          i += 2;
          continue;
        }
        if (HIRAGANA_ROMAJI[twoChar] !== undefined) {
          result += HIRAGANA_ROMAJI[twoChar];
          i += 2;
          continue;
        }
      }
      const oneChar = katakanaStr[i];
      // Handle っ/ッ (double consonant)
      if (oneChar === 'ッ' || oneChar === 'っ') {
        // Double the next consonant
        if (i + 1 < katakanaStr.length) {
          const nextTwo = katakanaStr.substring(i + 1, i + 3);
          const nextOne = katakanaStr[i + 1];
          const nextRomaji = KATAKANA_ROMAJI[nextTwo] || KATAKANA_ROMAJI[nextOne] || 
                             HIRAGANA_ROMAJI[nextTwo] || HIRAGANA_ROMAJI[nextOne] || '';
          if (nextRomaji.length > 0) {
            result += nextRomaji[0]; // Double the first consonant
          }
        }
        i++;
        continue;
      }
      if (KATAKANA_ROMAJI[oneChar] !== undefined) {
        result += KATAKANA_ROMAJI[oneChar];
      } else if (HIRAGANA_ROMAJI[oneChar] !== undefined) {
        result += HIRAGANA_ROMAJI[oneChar];
      } else {
        // Pass through non-kana characters (spaces, punctuation, etc.)
        result += oneChar;
      }
      i++;
    }
    return result;
  }

  async function initKuromoji() {
    if (kuromojiTokenizer || kuromojiLoading) return;
    kuromojiLoading = true;
    const dictPath = chrome.runtime.getURL('lib/dict/');
    console.log('[DUAL SUBS] Loading kuromoji dictionary from:', dictPath);
    return new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictPath }).build((err, tokenizer) => {
        if (err) {
          console.error('[DUAL SUBS] Kuromoji init error:', err);
          kuromojiLoading = false;
          reject(err);
          return;
        }
        kuromojiTokenizer = tokenizer;
        kuromojiLoading = false;
        console.log('[DUAL SUBS] Kuromoji loaded successfully');
        resolve();
      });
    });
  }

  function tokenizeWithRomaji(text) {
    if (!kuromojiTokenizer || !text) return null;
    // Strip HTML tags
    const cleanText = text.replace(/<[^>]+>/g, '');
    const tokens = kuromojiTokenizer.tokenize(cleanText);
    const wordGroups = [];
    for (const token of tokens) {
      const reading = token.reading || token.pronunciation || token.surface_form;
      let romaji = '';
      if (reading && reading !== '*') {
        romaji = katakanaToRomaji(reading);
      } else {
        romaji = token.surface_form;
      }
      const basicForm = (token.basic_form && token.basic_form !== '*') ? token.basic_form : token.surface_form;
      wordGroups.push({
        surface: token.surface_form,
        romaji,
        basic_form: basicForm,
        pos: token.pos || '',           // e.g. 名詞, 動詞, 形容詞
        pos_detail: token.pos_detail_1 || '' // e.g. 形容動詞語幹
      });
    }
    return wordGroups;
  }

  // Function to load settings from storage
  async function loadSettings() {
    const data = await chrome.storage.local.get(settings);
    settings = data;
    console.log("[DUAL SUBS] Settings loaded:", settings);
  }

  // Function to send errors to the popup
  function sendErrorToPopup(message) {
    console.error(`[DUAL SUBS] Error: ${message}`);
    chrome.runtime.sendMessage({ type: "error", message: message });
  }

  // --- MESSAGE LISTENER for commands from popup.js & background.js ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "removeSubtitles") {
      removeSubs();
      sendResponse({ status: "Subtitles removed" });
    }
    if (request.type === 'INCOMING_LIVE_TRANSCRIPT') {
      handleLiveTranscript(request.text, request.isFinal);
    }
    return true;
  });

  // --- LIVE TRANSCRIPTION OVERLAY SUPPORT ---
  let isLiveMode = false;
  let currentLiveSentence = "";

  function handleLiveTranscript(text, isFinal) {
    if (!isLiveMode) {
      isLiveMode = true;
      createOverlay(); // Ensure overlay exists
      subsVisible = true;
    }

    const originalDiv = document.getElementById('dual-subs-original');
    const translatedDiv = document.getElementById('dual-subs-translated');
    const originalContainer = document.getElementById('dual-subs-original-container');
    
    if (!originalDiv || !translatedDiv) return;

    // For live mode, hide the word-aligned container as we don't have tokenization yet for live streams
    if (originalContainer) originalContainer.style.display = 'none';
    
    originalDiv.style.display = 'block';
    translatedDiv.style.display = 'block';

    if (isFinal) {
      // Complete sentence received
      currentLiveSentence += text + " ";
      originalDiv.textContent = currentLiveSentence;
      translateLiveText(currentLiveSentence, translatedDiv);
    } else {
      // Partial sentence received (user still speaking)
      originalDiv.textContent = currentLiveSentence + text;
      translatedDiv.textContent = "..."; // Show indicator while waiting
    }
  }

  // Simple debounce for live translation to save hits on the free endpoint
  let liveTranslationTimeout = null;
  function translateLiveText(textToTranslate, translatedDivElement) {
    if (liveTranslationTimeout) clearTimeout(liveTranslationTimeout);
    
    liveTranslationTimeout = setTimeout(async () => {
      try {
        const targetLangUrl = encodeURIComponent(settings.targetLang);
        const sourceTextUrl = encodeURIComponent(textToTranslate);
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLangUrl}&dt=t&q=${sourceTextUrl}`);
        const data = await res.json();
        
        let translatedText = "";
        if (data && data[0]) {
          data[0].forEach(chunk => {
             if (chunk[0]) translatedText += chunk[0];
          });
        }
        translatedDivElement.textContent = translatedText;
        
        // Reset current sentence after translation so next sentence starts fresh
        currentLiveSentence = "";
      } catch (err) {
        console.error("[DUAL SUBS] Free Live Translation Error:", err);
        translatedDivElement.textContent = "[Translation Error]";
      }
    }, 800); // Wait 800ms of non-speaking before executing translation
  }

  // *****************************************************************
  // TRIGGER ONCE AND PREPARE FUTURE TRIGGERS (YOUTUBE IS SINGLE PAGE)
  // *****************************************************************

  handleVideoNavigation();
  addTrigger();
  function addTrigger() {
    if (location.href.startsWith("https://www.youtube.com")) {
      document.addEventListener("yt-navigate-finish", () => {
        handleVideoNavigation();
      });
    } else if (isMobile) {
      window.addEventListener("popstate", handleVideoNavigation);
      const originalPushState = history.pushState;
      history.pushState = function () {
        originalPushState.apply(this, arguments);
        handleVideoNavigation();
      };
      const originalReplaceState = history.replaceState;
      history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        handleVideoNavigation();
      };
    }
  }

  // ***********************
  // MAIN FUNCTION AND LOGIC
  // ***********************

  async function handleVideoNavigation() {
    console.log("handleVideoNavigation called");
    await loadSettings();

    const newVideoID = extractYouTubeVideoID();
    if (!newVideoID) {
      console.log("[DUAL SUBS] Not on a video page, returning");
      currentVideoID = null;
      fired = false;
      return;
    }
    if (newVideoID !== currentVideoID) {
      console.log("[DUAL SUBS] Video ID changed, resetting fired variable", currentVideoID, newVideoID);
      currentVideoID = newVideoID;
      fired = false;
    }

    if (fired == true) return;

    fired = true;
    console.log("[DUAL SUBS] FIRED");
    removeSubs();

    const languageCheckPassed = await checkLanguageCode();
    if (!languageCheckPassed) {
      sendErrorToPopup("No suitable original language subtitles found.");
      return;
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let subtitleURL = null;
    for (let attempt = 0; attempt < 3 && subtitleURL == null; attempt++) {
      if (attempt > 0) await sleep(5000);
      try {
        subtitleURL = await extractSubtitleUrl();
      } catch (error) {
        console.log(`Attempt ${attempt + 1} failed:`, error);
      }
    }

    if (subtitleURL == null) {
      sendErrorToPopup("Could not extract subtitle URL. Timedtext not found.");
      return;
    }

    const url = new URL(subtitleURL);
    url.searchParams.set("fmt", "vtt");
    url.searchParams.delete("tlang");

    // Create translated URL using target language from settings
    const transUrl = new URL(url);
    transUrl.searchParams.set("tlang", settings.targetLang);

    console.log(`[DUAL SUBS] Original Sub URL: ${url.toString()}`);
    console.log(`[DUAL SUBS] Translated Sub URL: ${transUrl.toString()}`);

    // Determine if the original language is Japanese (for romaji)
    const origLang = url.searchParams.get("lang") || "";
    const isJapanese = origLang.startsWith("ja") || origLang.startsWith("a.ja");

    // Fetch both subtitle tracks
    let originalCues = [];
    let translatedCues = [];

    try {
      const [origResp, transResp] = await Promise.all([
        fetch(url.toString()),
        fetch(transUrl.toString())
      ]);
      const origVTT = await origResp.text();
      const transVTT = await transResp.text();
      originalCues = parseVTT(origVTT);
      translatedCues = parseVTT(transVTT);
      
      // Export to global scope so the AI Chat can read the transcript
      window.originalCues = originalCues;
      window.translatedCues = translatedCues;
      
      console.log(`[DUAL SUBS] Parsed ${originalCues.length} original cues, ${translatedCues.length} translated cues`);
    } catch (error) {
      console.error("[DUAL SUBS] Error fetching subtitles:", error);
      sendErrorToPopup("Error fetching subtitle data.");
      return;
    }

    // Initialize kuromoji if romaji is enabled and language is Japanese
    if (settings.showRomaji && isJapanese && !kuromojiTokenizer) {
      try {
        await initKuromoji();
      } catch (error) {
        console.error("[DUAL SUBS] Failed to load kuromoji, romaji disabled:", error);
      }
    }

    // Pre-compute word groups (surface + romaji) for all original cues
    if (settings.showRomaji && isJapanese && kuromojiTokenizer) {
      for (const cue of originalCues) {
        cue.wordGroups = tokenizeWithRomaji(cue.text);
      }
      console.log("[DUAL SUBS] Romaji tokenization complete");
    }

    // Create and start the custom overlay + sidebar
    createOverlay();
    createSidebar();
    populateSidebar(originalCues, translatedCues, isJapanese);
    startSubtitleLoop(originalCues, translatedCues, isJapanese);

    // Turn off YouTube's built-in captions
    const subtitleButtonSelector = isMobile ? ".ytmClosedCaptioningButtonButton" : ".ytp-subtitles-button";
    const subtitleButton = document.querySelector(subtitleButtonSelector);
    if (subtitleButton && subtitleButton.getAttribute("aria-pressed") === "true") {
      console.log("[DUAL SUBS] YouTube's subtitle is on, switching off...");
      subtitleButton.click();
    }

    if (settings.autoPlay) {
      setTimeout(() => ensureVideoPlaying(), 500);
    }
  }

  function ensureVideoPlaying() {
    const video = document.querySelector("video");
    if (video && video.paused) {
      console.log("[DUAL SUBS] Video was paused, attempting to play...");
      video.play();
    }
  }

  // **********************
  // CUSTOM SUBTITLE OVERLAY
  // **********************

  let subsVisible = true;

  function createOverlay() {
    // Remove any existing overlay
    const existing = document.getElementById('dual-subs-overlay');
    if (existing) existing.remove();
    const existingToggle = document.getElementById('dual-subs-toggle');
    if (existingToggle) existingToggle.remove();

    const playerContainer = document.querySelector(
      isMobile ? '#player-container-id' : '#movie_player'
    );
    if (!playerContainer) {
      console.error("[DUAL SUBS] Could not find video player container");
      return;
    }

    // Ensure player container has position for absolute children
    const computedStyle = window.getComputedStyle(playerContainer);
    if (computedStyle.position === 'static') {
      playerContainer.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.id = 'dual-subs-overlay';

    // Container for word-aligned romaji + Japanese
    const originalContainer = document.createElement('div');
    originalContainer.id = 'dual-subs-original-container';

    // Fallback plain text original (used when romaji is off)
    const originalDiv = document.createElement('div');
    originalDiv.id = 'dual-subs-original';

    const translatedDiv = document.createElement('div');
    translatedDiv.id = 'dual-subs-translated';

    overlay.appendChild(originalContainer);
    overlay.appendChild(originalDiv);
    overlay.appendChild(translatedDiv);

    playerContainer.appendChild(overlay);

    // Toggle button on video player
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'dual-subs-toggle';
    toggleBtn.textContent = '字';
    toggleBtn.title = 'Toggle Dual Subtitles';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      subsVisible = !subsVisible;
      toggleBtn.classList.toggle('off', !subsVisible);

      // Toggle overlay
      overlay.style.display = subsVisible ? '' : 'none';

      // Toggle sidebar
      const sidebar = document.getElementById('dual-subs-sidebar');
      const sidebarToggle = document.getElementById('dual-subs-sidebar-toggle');
      if (sidebar) sidebar.style.display = subsVisible ? '' : 'none';
      if (sidebarToggle) sidebarToggle.style.display = subsVisible ? '' : 'none';
    });
    playerContainer.appendChild(toggleBtn);

    // --- Talk to Creator Button ---
    const talkBtn = document.createElement('button');
    talkBtn.id = 'talk-to-creator-btn';
    talkBtn.textContent = '🎤 Talk to Creator';
    talkBtn.title = 'Voice chat with AI Creator';
    talkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openChatSidebar();
    });
    playerContainer.appendChild(talkBtn);

    console.log("[DUAL SUBS] Custom overlay created");
  }

  function startSubtitleLoop(originalCues, translatedCues, isJapanese) {
    const video = document.querySelector("video");
    if (!video) return;

    const originalContainer = document.getElementById('dual-subs-original-container');
    const originalDiv = document.getElementById('dual-subs-original');
    const translatedDiv = document.getElementById('dual-subs-translated');

    if (!originalContainer || !originalDiv || !translatedDiv) return;

    let lastOrigText = null;
    let lastTransText = null;
    let lastActiveIndex = -1;

    function renderWordAligned(wordGroups, fullText = '') {
      originalContainer.innerHTML = '';
      for (const group of wordGroups) {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'dual-subs-word-group';

        const romajiSpan = document.createElement('span');
        romajiSpan.className = 'dual-subs-romaji-word';
        romajiSpan.textContent = group.romaji;

        const jpSpan = document.createElement('span');
        jpSpan.className = 'dual-subs-jp-word';
        jpSpan.textContent = group.surface;

        wordSpan.appendChild(romajiSpan);
        wordSpan.appendChild(jpSpan);
        originalContainer.appendChild(wordSpan);

        // Attach tooltip hover
        attachTooltipHover(wordSpan, group);

        // Attach click modal
        attachModalOnClick(wordSpan, group, fullText);

        // Attach right click save (two-finger click)
        attachSaveOnRightClick(wordSpan, group);

        // Reflect saved state
        const savedState = savedWords[group.basic_form || group.surface];
        if (savedState) applySaveStyle(wordSpan, savedState);
      }
    }

    function updateSidebarActive(cueIndex) {
      if (cueIndex === lastActiveIndex) return;
      lastActiveIndex = cueIndex;

      // Remove active from previous
      const prevActive = document.querySelector('.ds-subtitle-entry.active');
      if (prevActive) prevActive.classList.remove('active');

      if (cueIndex < 0) return;

      // Add active to current
      const entry = document.querySelector(`.ds-subtitle-entry[data-index="${cueIndex}"]`);
      if (entry) {
        entry.classList.add('active');
        // Auto-scroll into view
        const container = document.getElementById('ds-tab-subtitles');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const entryRect = entry.getBoundingClientRect();
          if (entryRect.top < containerRect.top || entryRect.bottom > containerRect.bottom) {
            entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    }

    function update() {
      const currentTime = video.currentTime;

      // Find current original cue (with index)
      const origCueIndex = findActiveCueIndex(originalCues, currentTime);
      const origCue = origCueIndex >= 0 ? originalCues[origCueIndex] : null;
      // Find current translated cue
      const transCue = findActiveCue(translatedCues, currentTime);

      const origText = origCue ? origCue.text.replace(/<[^>]+>/g, '') : '';
      const transText = transCue ? transCue.text.replace(/<[^>]+>/g, '') : '';

      // Only update DOM when text changes
      if (origText !== lastOrigText) {
        lastOrigText = origText;

        if (settings.showRomaji && isJapanese && origCue && origCue.wordGroups) {
          // Word-aligned mode: romaji above each word
          originalContainer.style.display = origText ? 'flex' : 'none';
          originalDiv.style.display = 'none';
          if (origText) {
            renderWordAligned(origCue.wordGroups, origText);
          }
        } else {
          // Fallback: plain text without romaji
          originalContainer.style.display = 'none';
          originalDiv.textContent = origText;
          originalDiv.style.display = origText ? 'block' : 'none';
        }

        // Update sidebar active entry
        updateSidebarActive(origCueIndex);
      }

      if (transText !== lastTransText) {
        lastTransText = transText;
        translatedDiv.textContent = transText;
        translatedDiv.style.display = transText ? 'block' : 'none';
      }

      animFrameId = requestAnimationFrame(update);
    }

    // Cancel any existing animation loop
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(update);
  }

  function findActiveCue(cues, time) {
    // Binary search for the active cue
    let low = 0, high = cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cues[mid].end < time) {
        low = mid + 1;
      } else if (cues[mid].start > time) {
        high = mid - 1;
      } else {
        return cues[mid];
      }
    }
    return null;
  }

  function findActiveCueIndex(cues, time) {
    let low = 0, high = cues.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cues[mid].end < time) {
        low = mid + 1;
      } else if (cues[mid].start > time) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  // **********************
  // VTT PARSER
  // **********************

  function parseVTT(vttText) {
    const cues = [];
    const lines = vttText.split('\n');
    let i = 0;

    // Skip WEBVTT header
    while (i < lines.length && !lines[i].includes('-->')) {
      i++;
    }

    while (i < lines.length) {
      const line = lines[i].trim();

      // Look for timestamp lines: "00:00:01.000 --> 00:00:04.000"
      if (line.includes('-->')) {
        const match = line.match(
          /(\d{1,2}:?\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}\.\d{3})/
        );
        if (match) {
          const start = parseTimestamp(match[1]);
          const end = parseTimestamp(match[2]);

          // Collect text lines until empty line or next timestamp
          const textLines = [];
          i++;
          while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
            textLines.push(lines[i].trim());
            i++;
          }

          const text = textLines.join(' ')
            .replace(/align:start position:0%/g, '')
            .trim();

          if (text) {
            cues.push({ start, end, text });
          }
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    // Split long cues into shorter sentence-level chunks
    return splitLongCues(cues);
  }

  function splitLongCues(cues) {
    const result = [];
    const MAX_CHARS = 60; // Max characters per displayed cue

    for (const cue of cues) {
      const cleanText = cue.text.replace(/<[^>]+>/g, '');

      if (cleanText.length <= MAX_CHARS) {
        result.push(cue);
        continue;
      }

      // Split on Japanese sentence endings (。！？) or English ones (. ! ?)
      // Keep the delimiter attached to the preceding sentence
      const sentences = cleanText.split(/(?<=[。！？\.\!\?])\s*/).filter(s => s.trim());

      if (sentences.length <= 1) {
        // Can't split by sentences — try splitting by commas/、
        const parts = cleanText.split(/(?<=[、,])\s*/).filter(s => s.trim());
        if (parts.length <= 1) {
          result.push(cue);
          continue;
        }
        // Group comma-separated parts into chunks under MAX_CHARS
        const chunks = groupIntoChunks(parts, MAX_CHARS);
        distributeChunks(chunks, cue, result);
      } else {
        // Group sentences into chunks under MAX_CHARS
        const chunks = groupIntoChunks(sentences, MAX_CHARS);
        distributeChunks(chunks, cue, result);
      }
    }
    return result;
  }

  function groupIntoChunks(parts, maxChars) {
    const chunks = [];
    let current = '';
    for (const part of parts) {
      if (current && (current + part).length > maxChars) {
        chunks.push(current.trim());
        current = part;
      } else {
        current += part;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function distributeChunks(chunks, cue, result) {
    const duration = cue.end - cue.start;
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    let offset = cue.start;

    for (let j = 0; j < chunks.length; j++) {
      const chunkDuration = (chunks[j].length / totalLen) * duration;
      result.push({
        start: offset,
        end: offset + chunkDuration,
        text: chunks[j]
      });
      offset += chunkDuration;
    }
  }

  function parseTimestamp(ts) {
    // Handle both HH:MM:SS.mmm and MM:SS.mmm
    const parts = ts.split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
  }

  // **********************************
  // UTIL FUNCTIONS FOR ID AND LANGUAGE
  // **********************************

  function extractYouTubeVideoID() {
    const url = window.location.href;
    const patterns = {
      standard: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:[^?&]+&)*v=([^&]+)/,
      embed: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,
      mobile: /(?:https?:\/\/)?m\.youtube\.com\/watch\?v=([^&]+)/,
    };
    let videoID = null;
    if (patterns.standard.test(url)) {
      videoID = url.match(patterns.standard)[1];
    } else if (patterns.embed.test(url)) {
      videoID = url.match(patterns.embed)[1];
    } else if (patterns.mobile.test(url)) {
      videoID = url.match(patterns.mobile)[1];
    }
    return videoID;
  }

  function injectScript(filePath) {
    const script = document.createElement("script");
    script.setAttribute("type", "text/javascript");
    script.setAttribute("src", chrome.runtime.getURL(filePath));
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  injectScript("injected.js");

  // Check languages and use settings
  function checkLanguageCode() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 5;
      const checkInterval = 2000;

      const listener = (event) => {
        clearInterval(intervalId);
        document.removeEventListener("DUALSUBS_SEND_TRACKS", listener);

        const { tracks, error } = event.detail;
        if (error) {
          console.log("[DUAL SUBS] Error from injected script:", error);
          resolve(false);
          return;
        }

        if (tracks && tracks.length > 0) {
          console.log("[DUAL SUBS] Received tracks:", tracks);

          const autoTracksFound = tracks.some(
            (track) =>
              track.languageCode && settings.originalLangs.some((lang) => track.languageCode.startsWith(`a.${lang}`))
          );

          if (autoTracksFound) {
            console.log("[DUAL SUBS] Auto-generated track found (prioritized).");
            resolve(true);
            return;
          }

          const manualTracksFound = tracks.some(
            (track) => track.languageCode && settings.originalLangs.some((lang) => track.languageCode.includes(lang))
          );

          if (manualTracksFound) {
            console.log("[DUAL SUBS] Manual track found.");
            resolve(true);
          } else {
            console.log(`[DUAL SUBS] Target languages (${settings.originalLangs.join(", ")}) not found in tracks.`);
            resolve(false);
          }
        } else {
          console.log("[DUAL SUBS] Player data not yet available. Will retry.");
        }
      };

      document.addEventListener("DUALSUBS_SEND_TRACKS", listener);

      const intervalId = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
          console.log("[DUAL SUBS] Language check failed after all attempts.");
          clearInterval(intervalId);
          document.removeEventListener("DUALSUBS_SEND_TRACKS", listener);
          resolve(false);
          return;
        }
        document.dispatchEvent(new CustomEvent("DUALSUBS_GET_TRACKS"));
      }, checkInterval);
    });
  }

  // ****************************
  // UTIL FUNCTIONS FOR SUBTITLES
  // ****************************

  async function extractSubtitleUrl() {
    const isMobile = location.href.startsWith("https://m.youtube.com");
    const subtitleButtonSelector = isMobile ? ".ytmClosedCaptioningButtonButton" : ".ytp-subtitles-button";
    if (isMobile) {
      document.querySelector("#movie_player").click();
      document.querySelector("#movie_player").click();
    }
    async function findSubtitleButtonWithRetry(selector, maxAttempts = 3, delayMs = 1000) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const button = document.querySelector(selector);
        if (button) return button;
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return null;
    }
    const subtitleButton = await findSubtitleButtonWithRetry(subtitleButtonSelector);
    if (!subtitleButton) return null;
    const initialEntryCount = performance.getEntriesByType("resource").length;
    subtitleButton.click();
    subtitleButton.click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const newEntries = performance.getEntriesByType("resource").slice(initialEntryCount);
    for (const entry of newEntries) {
      if (entry.name.includes("timedtext") && entry.name.includes("&pot=")) {
        console.log("[DUAL SUBS] ✅ Found matching timedtext request!");
        return entry.name;
      }
    }
    console.log("[DUAL SUBS] ❌ No timedtext requests found");
    return null;
  }

  function removeSubs() {
    console.log(`[DUAL SUBS] Removing existing subtitles.`);
    // Cancel animation loop
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    // Remove overlay
    const overlay = document.getElementById('dual-subs-overlay');
    if (overlay) overlay.remove();
    // Remove toggle button
    const toggleBtn = document.getElementById('dual-subs-toggle');
    if (toggleBtn) toggleBtn.remove();
    // Remove sidebar
    const sidebar = document.getElementById('dual-subs-sidebar');
    if (sidebar) sidebar.remove();
    const toggle = document.getElementById('dual-subs-sidebar-toggle');
    if (toggle) toggle.remove();
    // Also remove any legacy track elements
    const video = document.getElementsByTagName("video")[0];
    if (!video) return;
    const tracks = video.getElementsByTagName("track");
    Array.from(tracks).forEach(function (ele) {
      ele.track.mode = "hidden";
      ele.parentNode.removeChild(ele);
    });
  }

  // **********************
  // SIDEBAR TRANSCRIPT
  // **********************

  function createSidebar() {
    // Remove any existing sidebar
    const existing = document.getElementById('dual-subs-sidebar');
    if (existing) existing.remove();
    const existingToggle = document.getElementById('dual-subs-sidebar-toggle');
    if (existingToggle) existingToggle.remove();

    // Build sidebar DOM
    const sidebar = document.createElement('div');
    sidebar.id = 'dual-subs-sidebar';

    // Header
    const header = document.createElement('div');
    header.className = 'ds-sidebar-header';

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'ds-sidebar-tabs';

    const tabNames = ['Subtitles', 'Words', 'Saved', 'AI Chat'];
    tabNames.forEach((name, i) => {
      const tab = document.createElement('button');
      tab.className = 'ds-sidebar-tab' + (i === 0 ? ' active' : '');
      tab.textContent = name;
      tab.dataset.tab = name.toLowerCase();
      tab.addEventListener('click', () => switchTab(name.toLowerCase()));
      tabs.appendChild(tab);
    });

    // Icons
    const icons = document.createElement('div');
    icons.className = 'ds-sidebar-icons';

    const starBtn = document.createElement('button');
    starBtn.className = 'ds-sidebar-icon-btn';
    starBtn.innerHTML = '☆';
    starBtn.title = 'Save';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'ds-sidebar-icon-btn';
    pinBtn.innerHTML = '📌';
    pinBtn.title = 'Pin';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ds-sidebar-icon-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => toggleSidebar(false));

    icons.appendChild(starBtn);
    icons.appendChild(pinBtn);
    icons.appendChild(closeBtn);

    header.appendChild(tabs);
    header.appendChild(icons);

    // Content areas
    const subtitlesContent = document.createElement('div');
    subtitlesContent.className = 'ds-sidebar-content';
    subtitlesContent.id = 'ds-tab-subtitles';

    const wordsContent = document.createElement('div');
    wordsContent.className = 'ds-sidebar-content';
    wordsContent.id = 'ds-tab-words';
    wordsContent.style.display = 'none';

    const savedContent = document.createElement('div');
    savedContent.className = 'ds-sidebar-content';
    savedContent.id = 'ds-tab-saved';
    savedContent.style.display = 'none';
    populateSavedTab(savedContent);

    const aichatContent = document.createElement('div');
    aichatContent.className = 'ds-sidebar-content ds-ai-chat-container';
    aichatContent.id = 'ds-tab-ai chat'; // intentionally using the tabName space
    aichatContent.style.display = 'none';
    // We will populate AI chat UI separately
    buildAiChatUI(aichatContent);

    sidebar.appendChild(header);
    sidebar.appendChild(subtitlesContent);
    sidebar.appendChild(wordsContent);
    sidebar.appendChild(savedContent);
    sidebar.appendChild(aichatContent);

    document.body.appendChild(sidebar);

    // Sidebar Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'dual-subs-sidebar-toggle';
    toggleBtn.innerHTML = '☰';
    toggleBtn.title = 'Toggle transcript panel';
    toggleBtn.classList.add('sidebar-open');
    toggleBtn.addEventListener('click', () => {
      const isHidden = sidebar.classList.contains('hidden');
      toggleSidebar(isHidden);
    });
    document.body.appendChild(toggleBtn);

    // Cinema Mode Toggle
    if (!document.getElementById('dual-subs-cinema-toggle')) {
      const cinemaToggle = document.createElement('button');
      cinemaToggle.id = 'dual-subs-cinema-toggle';
      cinemaToggle.innerHTML = '💡';
      cinemaToggle.title = 'Cinema Mode';
      cinemaToggle.classList.add('sidebar-open');
      
      const cutout = document.createElement('div');
      cutout.id = 'ds-cinema-cutout';
      document.body.appendChild(cutout);

      let cinemaRafId = null;

      function updateCutout() {
        if (!document.body.classList.contains('ds-cinema-active')) return;
        const player = document.querySelector('#movie_player') || document.querySelector('video');
        if (player) {
          const rect = player.getBoundingClientRect();
          cutout.style.top = rect.top + 'px';
          cutout.style.left = rect.left + 'px';
          cutout.style.width = rect.width + 'px';
          cutout.style.height = rect.height + 'px';
        }
        cinemaRafId = requestAnimationFrame(updateCutout);
      }

      cinemaToggle.addEventListener('click', () => {
        const bodyBtn = document.body;
        const isCinema = bodyBtn.classList.contains('ds-cinema-active');
        if (isCinema) {
          bodyBtn.classList.remove('ds-cinema-fade-in');
          setTimeout(() => bodyBtn.classList.remove('ds-cinema-active'), 400); // Wait for transition
          cinemaToggle.classList.remove('cinema-active');
          if (cinemaRafId) cancelAnimationFrame(cinemaRafId);
        } else {
          bodyBtn.classList.add('ds-cinema-active');
          updateCutout(); // Set initial position and start loop
          // small delay for transition class
          requestAnimationFrame(() => requestAnimationFrame(() => {
            bodyBtn.classList.add('ds-cinema-fade-in');
          }));
          cinemaToggle.classList.add('cinema-active');
        }
      });
      document.body.appendChild(cinemaToggle);
    }

    console.log('[DUAL SUBS] Sidebar created');
  }

  function openChatSidebar() {
    const sidebar = document.getElementById('dual-subs-sidebar');
    if (sidebar) {
      if (sidebar.classList.contains('hidden')) toggleSidebar(true);
      
      // Specifically switch to the AI Chat tab
      const chatTab = document.querySelector('.ds-sidebar-tab[data-target="ai chat"]');
      if (chatTab) chatTab.click();
    }
  }

  // **********************
  // AI CHAT FEATURE
  // **********************

  function buildAiChatUI(container) {
    container.innerHTML = `
      <div class="ds-aichat-header">
        <div style="font-weight:600;">Talk to the Creator</div>
      </div>


      <!-- Chat Thread -->
      <div id="ds-aichat-thread" class="ds-aichat-thread">
        <div class="ds-chat-msg ds-chat-system">
          Hello! I am the creator of this video. Feel free to ask me questions about Japanese grammar, vocabulary, or the topics discussed!
        </div>
      </div>

      <!-- Input Area -->
      <div class="ds-aichat-input-area">
        <textarea id="ds-aichat-textarea" placeholder="Type or speak a message..." rows="1"></textarea>
        <div class="ds-aichat-controls">
          <button id="ds-aichat-mic-btn" class="ds-aichat-action-btn" title="Voice Dictation">🎤</button>
          <button id="ds-aichat-send-btn" class="ds-aichat-action-btn ds-send" title="Send">➤</button>
        </div>
      </div>
    `;

    // Elements
    const thread = container.querySelector('#ds-aichat-thread');
    const textarea = container.querySelector('#ds-aichat-textarea');
    const micBtn = container.querySelector('#ds-aichat-mic-btn');
    const sendBtn = container.querySelector('#ds-aichat-send-btn');

    // Hardcoded API Keys
    let currentApiKey = 'AIzaSyCN82IUns9poi9kr_F7KZYzOB5eVsJ4AiM';
    let currentElevenLabsApiKey = 'sk_461a3d33bf6a5980b46dfd3c41f194468e08bc0cdbbf59ca';
    let currentElevenLabsVoiceId = '';

    // API Messaging State
    let conversationHistory = []; // stores { role: "system" | "user" | "assistant", content: "..." }

    function buildSystemContext() {
      let context = "You are the creator and speaker of this YouTube video. The user watching is learning Japanese and wants to talk directly to YOU.\n" +
                    "CRITICAL INSTRUCTION 1: You MUST speak in the first person ('I', 'me', 'my video'). NEVER refer to the speaker in the third person.\n" +
                    "CRITICAL INSTRUCTION 2: You MUST speak in 100% casual Japanese (タメ口 - Tamego). NEVER use formal Japanese (Desu/Masu form). Speak like you are texting a close friend.\n" +
                    "CRITICAL INSTRUCTION 3: Mirror the user's energy. If they say 'wassup', 'yo', or 'hey', you MUST reply with super casual slang like 'うぇーい！', 'やっほー！', 'おっす！', or 'マジで'.\n" +
                    "CRITICAL INSTRUCTION 4: Your response MUST strictly follow this exact format with 3 separate lines. You MUST start your response immediately with 'JP:' and end after 'EN:'. Do not add conversational filler like 'Sure!' or any other text:\n" +
                    "JP: (Your casual Japanese reply here)\n" +
                    "RM: (The Romaji for your Japanese reply)\n" +
                    "EN: (The English translation of your reply)\n\n" +
                    "Here is the full transcript of what YOU said in the video, with original Japanese and translated English:\n\n";
      
      if (window.originalCues && window.translatedCues) {
        for (let i = 0; i < window.originalCues.length; i++) {
          const orig = window.originalCues[i];
          const trans = window.translatedCues[i];
          const time = orig.start ? new Date(orig.start * 1000).toISOString().substr(14, 5) : "";
          if (orig.text) {
            context += `[${time}] JP: ${orig.text.replace(/<[^>]+>/g, '')}\n`;
            if (trans && trans.text) {
               context += `       EN: ${trans.text.replace(/<[^>]+>/g, '')}\n`;
            }
          }
        }
      } else {
         context += "(Transcript not fully available yet.)\n";
      }
      return context;
    }

    function appendMessage(role, text) {
      const msgDiv = document.createElement('div');
      msgDiv.className = `ds-chat-msg ds-chat-${role}`;
      msgDiv.textContent = text;
      thread.appendChild(msgDiv);
      thread.scrollTop = thread.scrollHeight;
    }

    async function sendToGemini(userText) {
      if (!currentApiKey) {
        appendMessage('system', 'Please save your OpenRouter API Key in the settings (⚙️) first!');
        return;
      }
      
      appendMessage('user', userText);
      textarea.value = '';
      textarea.style.height = 'auto'; // reset resize

      // Initialize System Context if this is the first message
      if (conversationHistory.length === 0) {
        conversationHistory.push({
          role: "system",
          content: buildSystemContext()
        });
      }

      conversationHistory.push({
        role: "user",
        content: userText
      });

      const loadingMsg = document.createElement('div');
      loadingMsg.className = 'ds-chat-msg ds-chat-model ds-chat-loading';
      loadingMsg.textContent = '...';
      thread.appendChild(loadingMsg);
      thread.scrollTop = thread.scrollHeight;

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            system_instruction: {
               parts: [{ text: conversationHistory.find(m => m.role === 'system').content }]
            },
            contents: [
               ...conversationHistory.filter(m => m.role !== 'system').map(m => ({
                  role: m.role === 'user' ? 'user' : 'model',
                  parts: [{ text: m.content }]
               }))
            ],
            generationConfig: {
               temperature: 0.7,
               maxOutputTokens: 800
            }
          })
        });

        if (!response.ok) {
           let errMessage = `API Error: ${response.status}`;
           try {
             const errData = await response.json();
             if (errData.error && errData.error.message) {
               errMessage += ` - ${errData.error.message}`;
             }
           } catch (e) { /* ignore parse error */ }
           throw new Error(errMessage);
        }

        const data = await response.json();
        
        // Gemini API response structure parsing
        let aiText = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
           aiText = data.candidates[0].content.parts[0].text;
        }
        
        if (aiText) {
          loadingMsg.remove();
          
          let cleanAiText = aiText;
          const jpMatch = aiText.match(/(?:JP:|Japanese:)\s*(.*)/i);
          const rmMatch = aiText.match(/(?:RM:|Romaji:)\s*(.*)/i);
          const enMatch = aiText.match(/(?:EN:|English:)\s*(.*)/i);
          
          if (jpMatch && rmMatch && enMatch) {
            const jpText = jpMatch[1].trim();
            const rmText = rmMatch[1].trim();
            const enText = enMatch[1].trim();
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `ds-chat-msg ds-chat-model`;
            msgDiv.innerHTML = `
              <div style="font-size:11px;color:#a0a0b0;margin-bottom:2px;font-family:monospace;">${rmText}</div>
              <div style="font-size:14px;color:#fff;margin-bottom:4px;font-weight:500;">${jpText}</div>
              <div style="font-size:12px;color:#cbd5e1;line-height:1.3;">${enText}</div>
            `;
            thread.appendChild(msgDiv);
            thread.scrollTop = thread.scrollHeight;
            
            cleanAiText = jpText; // ONLY speak the Japanese part!
          } else {
            appendMessage('model', aiText); // using 'model' class for styling
            cleanAiText = aiText.replace(/(?:RM:|EN:|Romaji:|English:).*/gi, '').trim(); 
          }

          conversationHistory.push({
            role: "assistant",
            content: aiText // save full context so AI remembers what they said
          });
          
          // Read response out loud!
          playTTS(cleanAiText);
        } else {
          throw new Error("Empty response from AI");
        }
      } catch (err) {
        loadingMsg.remove();
        appendMessage('system', 'Error: ' + err.message);
        conversationHistory.pop(); // remove the failed user message from history
      }
    }

    sendBtn.addEventListener('click', () => {
      const text = textarea.value.trim();
      if (text) sendToGemini(text);
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    // Auto-resize textarea
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });

    // --- Web Speech API Dictation ---
    let recognition = null;
    let isRecording = false;

    if ('webkitSpeechRecognition' in window) {
      recognition = new webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'ja-JP'; // Default to Japanese (ideally auto-detect or toggleable, but JP makes sense here)

      let draftText = '';

      recognition.onstart = function() {
        isRecording = true;
        micBtn.classList.add('recording');
        micBtn.textContent = '🔴';
        draftText = textarea.value; // Store existing text
      };

      recognition.onresult = function(event) {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Update textarea preview live
        textarea.value = draftText + (draftText && finalTranscript ? ' ' : '') + finalTranscript + interimTranscript;
        
        if (finalTranscript) {
           draftText = textarea.value; // lock in the final part
        }
      };

      recognition.onerror = function(event) {
        console.error("Speech recognition error", event.error);
        stopDictation();
      };

      recognition.onend = function() {
        stopDictation();
      };
    } else {
      micBtn.style.display = 'none'; // Not supported
    }

    function stopDictation() {
      if (isRecording) {
        recognition.stop();
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.textContent = '🎤';
        
        // Auto-send if they released the button
        if (textarea.value.trim().length > 0) {
           sendBtn.click();
        }
      }
    }

    // Press and hold logic for Mic
    micBtn.addEventListener('mousedown', () => {
      if (recognition && !isRecording) {
        textarea.value = ''; // clear for new dictation
        recognition.start();
      }
    });
    
    micBtn.addEventListener('mouseup', () => {
      stopDictation();
    });
    micBtn.addEventListener('mouseleave', () => {
      stopDictation(); // in case mouse leaves button while holding
    });

  }

  function toggleSidebar(show) {
    const sidebar = document.getElementById('dual-subs-sidebar');
    const toggle = document.getElementById('dual-subs-sidebar-toggle');
    const cinemaToggle = document.getElementById('dual-subs-cinema-toggle');
    
    if (!sidebar || !toggle) return;
    if (show) {
      sidebar.classList.remove('hidden');
      toggle.classList.add('sidebar-open');
      if (cinemaToggle) cinemaToggle.classList.add('sidebar-open');
      document.body.classList.add('ds-sidebar-active');
    } else {
      sidebar.classList.add('hidden');
      toggle.classList.remove('sidebar-open');
      if (cinemaToggle) cinemaToggle.classList.remove('sidebar-open');
      document.body.classList.remove('ds-sidebar-active');
    }
  }

  function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.ds-sidebar-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    // Show/hide content
    ['subtitles', 'words', 'saved', 'ai chat'].forEach(name => {
      const el = document.getElementById(`ds-tab-${name}`);
      if (el) el.style.display = name === tabName ? '' : 'none';
    });
  }

  function populateSidebar(originalCues, translatedCues, isJapanese) {
    const container = document.getElementById('ds-tab-subtitles');
    if (!container) return;
    container.innerHTML = '';

    const video = document.querySelector('video');
    const wordFrequency = {};

    originalCues.forEach((cue, index) => {
      const entry = document.createElement('div');
      entry.className = 'ds-subtitle-entry';
      entry.dataset.index = index;
      entry.dataset.start = cue.start;

      // Click to seek
      entry.addEventListener('click', () => {
        if (video) video.currentTime = cue.start;
      });

      // Original text with word-aligned romaji
      const origDiv = document.createElement('div');
      origDiv.className = 'ds-entry-original';

      if (isJapanese && cue.wordGroups) {
        for (const group of cue.wordGroups) {
          const wordSpan = document.createElement('span');
          wordSpan.className = 'ds-entry-word-group';

          const romajiSpan = document.createElement('span');
          romajiSpan.className = 'ds-entry-romaji-word';
          romajiSpan.textContent = group.romaji;

          const jpSpan = document.createElement('span');
          jpSpan.className = 'ds-entry-jp-word';
          jpSpan.textContent = group.surface;

          wordSpan.appendChild(romajiSpan);
          wordSpan.appendChild(jpSpan);
          origDiv.appendChild(wordSpan);

          // Attach tooltip hover
          attachTooltipHover(wordSpan, group);

          // Attach click modal
          const cleanText = cue.text.replace(/<[^>]+>/g, '');
          attachModalOnClick(wordSpan, group, cleanText);

          // Attach right click save (two-finger click)
          attachSaveOnRightClick(wordSpan, group);

          // Reflect saved state initially
          const savedState = savedWords[group.basic_form || group.surface];
          if (savedState) applySaveStyle(wordSpan, savedState);

          // Track word frequency for Words tab
          if (group.surface.trim() && !/^[\s。、！？「」（）…・ー]+$/.test(group.surface)) {
            const key = group.surface;
            if (!wordFrequency[key]) {
              wordFrequency[key] = { surface: group.surface, romaji: group.romaji, basic_form: group.basic_form || group.surface, pos: group.pos || '', pos_detail: group.pos_detail || '', count: 0 };
            }
            wordFrequency[key].count++;
          }
        }
      } else {
        const cleanText = cue.text.replace(/<[^>]+>/g, '');
        origDiv.textContent = cleanText;
        origDiv.style.fontSize = '16px';
        origDiv.style.color = '#e0e0e0';
      }
      entry.appendChild(origDiv);

      // Find matching translation
      const matchedTrans = findActiveCue(translatedCues, cue.start + 0.1);
      if (matchedTrans) {
        const transDiv = document.createElement('div');
        transDiv.className = 'ds-entry-translation';
        transDiv.textContent = matchedTrans.text.replace(/<[^>]+>/g, '');
        entry.appendChild(transDiv);
      }

      container.appendChild(entry);
    });

    // Populate Words tab on click (instant — uses local JLPT data)
    const wordsTabBtn2 = document.querySelector('.ds-sidebar-tab[data-tab="words"]');
    if (wordsTabBtn2) {
      wordsTabBtn2.addEventListener('click', () => populateWordsTab(wordFrequency));
    }

    console.log(`[DUAL SUBS] Sidebar populated with ${originalCues.length} entries`);
  }

  // Maps kuromoji POS to our display category
  function getWordCategory(word) {
    const pos = word.pos || '';
    const detail = word.pos_detail || '';
    if (pos === '形容詞') return 'Adjectives';
    if (pos === '名詞' && detail === '形容動詞語幹') return 'Adjectives'; // na-adjectives
    if (pos === '動詞') return 'Verbs';
    if (pos === '名詞') return 'Nouns';
    if (pos === '助詞' || pos === '助動詞' || pos === '接続詞' || pos === '副詞' || pos === '連体詞') return 'Grammar';
    if (pos === '感動詞') return 'Slang'; // interjections / exclamations → slang
    return 'Other';
  }

  const jlptCache = {};
  let activeWordCategory = 'All';

  function populateWordsTab(wordFrequency) {
    const container = document.getElementById('ds-tab-words');
    if (!container) return;
    container.innerHTML = '';

    const words = Object.values(wordFrequency);
    if (words.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:#5a5a7a;font-size:13px">No words found yet.</div>';
      return;
    }

    // ── Category filter chips ──
    const filterBar = document.createElement('div');
    filterBar.className = 'ds-word-filter-bar';

    const categories = ['All', 'Nouns', 'Verbs', 'Adjectives', 'Grammar', 'Slang'];
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'ds-word-filter-btn' + (cat === activeWordCategory ? ' active' : '');
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        activeWordCategory = cat;
        populateWordsTab(wordFrequency); // re-render with new filter
      });
      filterBar.appendChild(btn);
    });
    container.appendChild(filterBar);

    // ── Filter words ──
    const filtered = activeWordCategory === 'All'
      ? words
      : words.filter(w => {
          const cat = getWordCategory(w);
          // Map "Slang" also to unknown JLPT words that are interjections/expressions
          if (activeWordCategory === 'Slang') return cat === 'Slang' || (cat === 'Other' && !JLPT_DATA[w.basic_form || w.surface]);
          return cat === activeWordCategory;
        });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px;color:#5a5a7a;font-size:13px;text-align:center';
      empty.textContent = 'No ' + activeWordCategory.toLowerCase() + ' found in this video yet.';
      container.appendChild(empty);
      return;
    }

    // Sort by frequency
    filtered.sort((a, b) => b.count - a.count);

    for (const word of filtered) {
      const item = document.createElement('div');
      item.className = 'ds-word-item';

      const leftDiv = document.createElement('div');
      const surface = document.createElement('div');
      surface.className = 'ds-word-surface';
      surface.textContent = word.surface;
      const romaji = document.createElement('div');
      romaji.className = 'ds-word-romaji';
      romaji.textContent = word.romaji;
      leftDiv.appendChild(surface);
      leftDiv.appendChild(romaji);

      const countSpan = document.createElement('span');
      countSpan.className = 'ds-word-count';
      countSpan.textContent = `×${word.count}`;

      item.appendChild(leftDiv);
      item.appendChild(countSpan);
      container.appendChild(item);

      attachTooltipHover(item, word);
    attachModalOnClick(item, word);
    attachSaveOnRightClick(item, word);

      // Reflect saved state
      const savedState = savedWords[word.basic_form || word.surface];
      if (savedState) applySaveStyle(item, savedState);
    }
  }

  // ── Word Save System Logic ────────────────────────────────────────

  function applySaveStyle(el, state) {
    const c = SAVE_COLORS[state];
    if (el.classList.contains('ds-word-item')) {
      // Words tab single item
      el.style.background = c.bg;
      el.style.borderLeft = '3px solid ' + c.border;
      el.style.paddingLeft = '9px';
      const s = el.querySelector('.ds-word-surface');
      if (s) s.style.color = c.text;
    } else if (el.classList.contains('dual-subs-word-group') || el.classList.contains('ds-entry-word-group')) {
      // Video subtitle overlay word OR sidebar transcript word
      const jp = el.querySelector('.dual-subs-jp-word') || el.querySelector('.ds-entry-jp-word');
      if (jp) {
        jp.style.color = c.text;
        jp.style.borderBottom = '3px solid ' + c.border;
      }
    }
  }

  function clearSaveStyle(el) {
    if (el.classList.contains('ds-word-item')) {
      el.style.background = '';
      el.style.borderLeft = '';
      el.style.paddingLeft = '';
      const s = el.querySelector('.ds-word-surface');
      if (s) s.style.color = '';
    } else if (el.classList.contains('dual-subs-word-group') || el.classList.contains('ds-entry-word-group')) {
      const jp = el.querySelector('.dual-subs-jp-word') || el.querySelector('.ds-entry-jp-word');
      if (jp) {
        jp.style.color = '';
        jp.style.borderBottom = '';
      }
    }
  }

  function attachSaveOnRightClick(el, word) {
    el.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const key = word.basic_form || word.surface;
      const current = savedWords[key];
      const idx = SAVE_STATES.indexOf(current);
      const next = idx < SAVE_STATES.length - 1 ? SAVE_STATES[idx + 1] : null;

      if (next) {
        savedWords[key] = next;
      } else {
        delete savedWords[key];
      }

      chrome.storage.local.set({ dsSavedWords: savedWords });

      // Apply style to all visible instances of this word
      const allInstances = document.querySelectorAll('.ds-word-item, .dual-subs-word-group, .ds-entry-word-group');
      for (const instance of allInstances) {
        let wText = '';
        if (instance.classList.contains('ds-word-item')) {
          wText = instance.querySelector('.ds-word-surface')?.textContent || '';
        } else {
          wText = (instance.querySelector('.dual-subs-jp-word') || instance.querySelector('.ds-entry-jp-word'))?.textContent || '';
        }
        
        // If the surface text matches, apply the style
        if (wText === word.surface) {
          if (next) applySaveStyle(instance, next);
          else clearSaveStyle(instance);
        }
      }

      // Refresh saved tab
      const savedTab = document.getElementById('ds-tab-saved');
      if (savedTab) populateSavedTab(savedTab);
    });
  }

  function populateSavedTab(container) {
    container.innerHTML = '';

    const groups = { known: [], remember: [], unknown: [] };
    for (const [key, state] of Object.entries(savedWords)) {
      groups[state].push(key);
    }

    const total = Object.keys(savedWords).length;
    if (total === 0) {
      container.innerHTML = '<div class="ds-saved-content"><div class="ds-empty-icon">⭐</div>Double-tap any word to save it</div>';
      return;
    }

    const sections = [
      { key: 'known',    label: 'Known',    icon: '✓', color: '#22c55e' },
      { key: 'remember', label: 'Remember', icon: '★', color: '#eab308' },
      { key: 'unknown',  label: 'Unknown',  icon: '?', color: '#9090b0' }
    ];

    for (const sec of sections) {
      const words = groups[sec.key];
      if (words.length === 0) continue;

      const header = document.createElement('div');
      header.className = 'ds-jlpt-header';
      header.innerHTML = `
        <span class="ds-jlpt-badge" style="background:${sec.color}">${sec.icon}</span>
        <span class="ds-jlpt-desc" style="color:${sec.color}">${sec.label}</span>
        <span class="ds-jlpt-count">${words.length} words</span>
      `;
      container.appendChild(header);

      for (const key of words) {
        const item = document.createElement('div');
        item.className = 'ds-word-item';
        applySaveStyle(item, sec.key);

        const surface = document.createElement('div');
        surface.className = 'ds-word-surface';
        surface.textContent = key;
        surface.style.color = SAVE_COLORS[sec.key].text;

        // Remove button
        const removeBtn = document.createElement('span');
        removeBtn.textContent = '×';
        removeBtn.style.cssText = 'cursor:pointer;color:#5a5a7a;font-size:16px;padding:0 4px';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          delete savedWords[key];
          chrome.storage.local.set({ dsSavedWords: savedWords });
          populateSavedTab(container);
        });

        item.appendChild(surface);
        item.appendChild(removeBtn);
        container.appendChild(item);
      }

      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.05);margin:4px 0';
      container.appendChild(sep);
    }
  }
  // ──────────────────────────────────────────────────────────────────

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // **********************
  // WORD MEANING TOOLTIP
  // **********************

  const dictCache = {};
  let activeTooltip = null;
  let tooltipTimeout = null;

  function attachTooltipHover(element, wordGroup) {
    // Skip punctuation/particles that are too short or just symbols
    const surface = wordGroup.surface.trim();
    if (!surface || /^[\s。、！？「」（）…・ー、,\.]+$/.test(surface)) return;

    element.style.cursor = 'pointer';
    element.style.pointerEvents = 'auto';

    element.addEventListener('mouseenter', (e) => {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(() => {
        showTooltip(e.target.closest('.dual-subs-word-group, .ds-entry-word-group') || e.target, wordGroup);
      }, 300);
    });

    element.addEventListener('mouseleave', () => {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(() => {
        hideTooltip();
      }, 200);
    });
  }

  async function showTooltip(anchor, wordGroup) {
    hideTooltip();

    const lookupWord = wordGroup.basic_form || wordGroup.surface;

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'dual-subs-tooltip';
    tooltip.innerHTML = `
      <div class="ds-tooltip-word">${wordGroup.surface}</div>
      <div class="ds-tooltip-romaji">${wordGroup.romaji}</div>
      <div class="ds-tooltip-loading">Looking up...</div>
    `;

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;
    tooltip._anchor = anchor; // Store anchor for repositioning

    // Keep tooltip alive on hover
    tooltip.addEventListener('mouseenter', () => clearTimeout(tooltipTimeout));
    tooltip.addEventListener('mouseleave', () => {
      tooltipTimeout = setTimeout(() => hideTooltip(), 200);
    });

    // Position tooltip
    positionTooltip(tooltip, anchor);

    // Fetch meaning
    try {
      const meanings = await fetchMeaning(lookupWord);
      if (!activeTooltip || activeTooltip !== tooltip) return;

      const loadingEl = tooltip.querySelector('.ds-tooltip-loading');
      if (loadingEl) loadingEl.remove();

      if (meanings && meanings.length > 0) {
        const meaningsDiv = document.createElement('div');
        meaningsDiv.className = 'ds-tooltip-meanings';
        meanings.forEach(m => {
          const item = document.createElement('div');
          item.className = 'ds-tooltip-meaning-item';
          if (m.pos) {
            const pos = document.createElement('span');
            pos.className = 'ds-tooltip-pos';
            pos.textContent = m.pos;
            item.appendChild(pos);
          }
          const def = document.createElement('span');
          def.className = 'ds-tooltip-def';
          def.textContent = m.definition;
          item.appendChild(def);
          meaningsDiv.appendChild(item);
        });
        tooltip.appendChild(meaningsDiv);
      } else {
        const noResult = document.createElement('div');
        noResult.className = 'ds-tooltip-no-result';
        noResult.textContent = 'No definition found';
        tooltip.appendChild(noResult);
      }

      // Reposition after content changed (tooltip grew taller)
      positionTooltip(tooltip, anchor);
    } catch (err) {
      console.error('[DUAL SUBS] Tooltip fetch error:', err);
      const errDiv = tooltip.querySelector('.ds-tooltip-loading');
      if (errDiv) errDiv.textContent = 'Lookup failed';
    }
  }

  // ── Word Detail Modal ─────────────────────────────────────────────
  
  function attachModalOnClick(element, wordGroup, fullText = '') {
    const surface = wordGroup.surface.trim();
    if (!surface || /^[\s。、！？「」（）…・ー、,\.]+$/.test(surface)) return;

    element.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      hideTooltip();

      // Pause Video
      const video = document.querySelector('video');
      if (video && !video.paused) {
        video.pause();
      }

      showWordModal(wordGroup, fullText);
    });
  }

  let dsModal = null;
  let dsModalBackdrop = null;

  // Preload voices for TTS
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.getVoices();
  }

  function ensureModalDOM() {
    const targetContainer = document.fullscreenElement || document.body;

    if (!dsModalBackdrop) {
      dsModalBackdrop = document.createElement('div');
      dsModalBackdrop.id = 'ds-word-modal-backdrop';
      dsModalBackdrop.addEventListener('click', closeWordModal);
    }
    
    if (!dsModal) {
      dsModal = document.createElement('div');
      dsModal.id = 'ds-word-modal';
      dsModal.innerHTML = `
        <div class="ds-modal-header">
          <div class="ds-modal-header-left">
            <div class="ds-modal-header-top">
              <span class="ds-modal-jp" id="ds-modal-jp-text"></span>
              <span class="ds-modal-romaji" id="ds-modal-rm-text"></span>
            </div>
            <div class="ds-modal-meaning" id="ds-modal-meaning-text">Loading...</div>
          </div>
          <div class="ds-modal-header-right">
            <button class="ds-modal-icon-btn" id="ds-modal-btn-audio" title="Play Audio">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </button>
            <button class="ds-modal-icon-btn" id="ds-modal-btn-close" title="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="ds-modal-tabs">
          <button class="ds-modal-tab active">Explain</button>
          <button class="ds-modal-tab">Examples</button>
        </div>
        <div class="ds-modal-content">
          <div class="ds-modal-def-block" id="ds-modal-def-content"></div>
          <div class="ds-modal-examples-header">Examples: Current text</div>
          <div class="ds-modal-example-box">
            <div class="ds-modal-example-sentence" id="ds-modal-example-sentence"></div>
          </div>
        </div>
        <div class="ds-modal-footer">
          <button class="ds-modal-save-btn" data-state="known" title="Known">✓</button>
          <button class="ds-modal-save-btn" data-state="remember" title="Remember">★</button>
          <button class="ds-modal-save-btn" data-state="unknown" title="Unknown">?</button>
          <button class="ds-modal-save-btn" data-state="none" title="Remove Save" style="margin-left:auto;">🚫</button>
        </div>
      `;
      
      dsModal.querySelector('#ds-modal-btn-close').addEventListener('click', closeWordModal);
      
      // Wire up footer save buttons
      dsModal.querySelectorAll('.ds-modal-save-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const state = btn.getAttribute('data-state');
          const wordKey = dsModal.dataset.currentWordKey;
          if (!wordKey) return;

          if (state === 'none') {
            delete savedWords[wordKey];
          } else {
            savedWords[wordKey] = state;
          }
          chrome.storage.local.set({ dsSavedWords: savedWords });
          
          // Sync Visuals
          const surface = dsModal.dataset.currentWordSurface;
          const allInstances = document.querySelectorAll('.ds-word-item, .dual-subs-word-group, .ds-entry-word-group');
          for (const instance of allInstances) {
            let wText = '';
            if (instance.classList.contains('ds-word-item')) {
              wText = instance.querySelector('.ds-word-surface')?.textContent || '';
            } else {
              wText = (instance.querySelector('.dual-subs-jp-word') || instance.querySelector('.ds-entry-jp-word'))?.textContent || '';
            }
            if (wText === surface) {
              if (state !== 'none') applySaveStyle(instance, state);
              else clearSaveStyle(instance);
            }
          }

          const savedTab = document.getElementById('ds-tab-saved');
          if (savedTab) populateSavedTab(savedTab);

          updateModalSaveButtons(wordKey);
        });
      });
    }

    // Always ensure it is mounted to the topmost valid container (helps with fullscreen changes)
    if (dsModalBackdrop.parentElement !== targetContainer) {
      targetContainer.appendChild(dsModalBackdrop);
    }
    if (dsModal.parentElement !== targetContainer) {
      targetContainer.appendChild(dsModal);
    }
  }


  let currentAudio = null;

  function playTTS(text) {
    // Hardcoded API Keys
    const elevenLabsApiKey = 'sk_461a3d33bf6a5980b46dfd3c41f194468e08bc0cdbbf59ca';
    const voiceId = "pNInz6obpgDQGcFmaJcg"; // default voice
    
    (async () => {
        try {
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenLabsApiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75
              }
            })
          });
          if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            if (currentAudio) {
               currentAudio.pause();
               URL.revokeObjectURL(currentAudio.src);
            }
            currentAudio = new Audio(url);
            currentAudio.play();
            return;
          } else {
             console.error("ElevenLabs status bad", response.status);
             const errText = await response.text();
             console.error(errText);
          }
        } catch (e) {
          console.error("ElevenLabs TTS Error", e);
        }
    })();
  }

  async function showWordModal(wordGroup, fullText) {
    ensureModalDOM();
    
    const lookupWord = wordGroup.basic_form || wordGroup.surface;
    dsModal.dataset.currentWordKey = lookupWord;
    dsModal.dataset.currentWordSurface = wordGroup.surface;

    // Pronounce Immediately
    playTTS(wordGroup.surface);

    // Audio button re-trigger
    const audioBtn = dsModal.querySelector('#ds-modal-btn-audio');
    audioBtn.onclick = () => playTTS(wordGroup.surface);

    dsModal.querySelector('#ds-modal-jp-text').textContent = wordGroup.surface;
    dsModal.querySelector('#ds-modal-rm-text').textContent = wordGroup.romaji;
    dsModal.querySelector('#ds-modal-meaning-text').textContent = "Loading...";
    dsModal.querySelector('#ds-modal-def-content').innerHTML = '';

    // Render Context Sentence
    const sentenceEl = dsModal.querySelector('#ds-modal-example-sentence');
    sentenceEl.innerHTML = '';
    
    if (fullText) {
      // Very basic highlight of the current word in the full text
      // Ideally we would have wordGroups for the whole sentence to do furigana,
      // but we will do a simple string replace for now.
      const parts = fullText.split(wordGroup.surface);
      if (parts.length > 1) {
        // Build DOM
        const pre = document.createTextNode(parts[0]);
        sentenceEl.appendChild(pre);

        const highlight = document.createElement('div');
        highlight.className = 'ds-modal-example-word ds-modal-example-highlight';
        highlight.innerHTML = `<span class="ds-modal-example-romaji">${wordGroup.romaji}</span><span class="ds-modal-example-jp">${wordGroup.surface}</span>`;
        sentenceEl.appendChild(highlight);

        const post = document.createTextNode(parts.slice(1).join(wordGroup.surface));
        sentenceEl.appendChild(post);
      } else {
        sentenceEl.textContent = fullText;
      }
    }

    updateModalSaveButtons(lookupWord);

    dsModal.classList.add('ds-open');
    dsModalBackdrop.classList.add('ds-open');

    // Fetch Jisho
    const meanings = await fetchMeaning(lookupWord);
    if (!meanings || meanings.length === 0) {
      dsModal.querySelector('#ds-modal-meaning-text').textContent = "No definition found";
      return;
    }

    // Use first meaning for header
    dsModal.querySelector('#ds-modal-meaning-text').textContent = meanings[0].definition.split(',')[0];

    // Render all meanings in Explain tab
    const defHtml = meanings.map(m => {
      let html = '<div style="margin-bottom: 12px;">';
      if (m.pos) {
        html += `<div style="color: #8b5cf6; font-size: 13px; font-style: italic; margin-bottom: 4px;">${m.pos}</div>`;
      }
      html += `<div style="color: #fff;">${m.definition}</div>`;
      html += '</div>';
      return html;
    }).join('');
    
    dsModal.querySelector('#ds-modal-def-content').innerHTML = defHtml;
  }

  function updateModalSaveButtons(wordKey) {
    if (!dsModal) return;
    const current = savedWords[wordKey] || 'none';
    dsModal.querySelectorAll('.ds-modal-save-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-state') === current);
    });
  }

  function closeWordModal() {
    if (dsModal) dsModal.classList.remove('ds-open');
    if (dsModalBackdrop) dsModalBackdrop.classList.remove('ds-open');
  }

  // ──────────────────────────────────────────────────────────────────

  function positionTooltip(tooltip, anchor) {
    // First render off-screen to get dimensions
    tooltip.style.top = '-9999px';
    tooltip.style.left = '-9999px';

    requestAnimationFrame(() => {
      const rect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      // Strongly prefer above the word
      let top = rect.top - tooltipRect.height - 12;
      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

      // Only go below if absolutely no room above
      if (top < 5) {
        top = rect.bottom + 12;
      }

      // Keep within horizontal bounds
      if (left < 10) left = 10;
      if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
      }

      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
    });
  }

  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  async function fetchMeaning(word) {
    if (dictCache[word]) return dictCache[word];
    try {
      const response = await chrome.runtime.sendMessage({ type: 'JISHO_LOOKUP', word: word });
      const meanings = response?.meanings || [];
      dictCache[word] = meanings;
      // Also cache JLPT level
      if (jlptCache[word] === undefined) {
        jlptCache[word] = response?.jlptLevel || null;
      }
      return meanings;
    } catch (err) {
      console.error('[DUAL SUBS] Jisho lookup error:', err);
      return null;
    }
  }
})();
