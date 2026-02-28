// offscreen.js
// Runs in an invisible offscreen document to maintain AudioContext and WebSockets

let audioContext;
let mediaStreamSource;
let isRecording = false;

// Mock WebSocket or actual STT Service Connection
let sttSocket = null; 

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE') {
    startCapture(message.streamId, message.apiKey);
  } else if (message.type === 'STOP_CAPTURE') {
    stopCapture();
  }
});

async function startCapture(streamId, apiKey) {
  if (isRecording) return;

  try {
    // 1. Get the MediaStream using the streamId provided by chrome.tabCapture
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    isRecording = true;

    // 2. Set up Web Audio API 
    // We must route the audio to the destination so the user can still hear the video!
    audioContext = new AudioContext({ sampleRate: 16000 }); // 16kHz is standard for STT
    mediaStreamSource = audioContext.createMediaStreamSource(stream);
    mediaStreamSource.connect(audioContext.destination);

    // 3. Extract Audio Data for STT
    // Use an AudioWorklet or ScriptProcessor to get raw PCM data
    // (Using ScriptProcessor for simplicity here, though deprecated, it works well in extensions)
    const bufferSize = 4096;
    const scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    scriptNode.onaudioprocess = (audioProcessingEvent) => {
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const inputData = inputBuffer.getChannelData(0); // Float32Array
      
      // Convert Float32Array to Int16Array for APIs like Deepgram
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        let s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // 4. Send to STT WebSocket
      if (sttSocket && sttSocket.readyState === WebSocket.OPEN) {
        sttSocket.send(pcm16.buffer);
      }
    };

    mediaStreamSource.connect(scriptNode);
    scriptNode.connect(audioContext.destination);

    // 5. Connect to Cloud STT (e.g., Deepgram)
    connectToSTT(apiKey);

  } catch (err) {
    console.error("[DUAL SUBS OFFSCREEN] Failed to start capture:", err);
  }
}

function stopCapture() {
  isRecording = false;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (sttSocket) {
    sttSocket.close();
    sttSocket = null;
  }
}

function connectToSTT(apiKey) {
  // Example using Deepgram's streaming WebSocket API
  // You can easily swap this for AssemblyAI or Groq later
  const deepgramUrl = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&language=ja';
  
  sttSocket = new WebSocket(deepgramUrl, ['token', apiKey]);

  sttSocket.onopen = () => {
    console.log("[DUAL SUBS OFFSCREEN] Connected to STT Service");
  };

  sttSocket.onmessage = (event) => {
    const response = JSON.parse(event.data);
    
    // Check if the response contains transcribed text
    if (response.channel && response.channel.alternatives && response.channel.alternatives[0]) {
      const transcript = response.channel.alternatives[0].transcript;
      const isFinal = response.is_final;
      
      if (transcript.trim() !== '') {
        // Send the transcribed text back out to the extension (content script / background)
        chrome.runtime.sendMessage({
          type: 'STT_TRANSCRIPT',
          text: transcript,
          isFinal: isFinal
        });
      }
    }
  };

  sttSocket.onerror = (error) => {
    console.error("[DUAL SUBS OFFSCREEN] STT WebSocket Error:", error);
  };

  sttSocket.onclose = () => {
    console.log("[DUAL SUBS OFFSCREEN] STT WebSocket Closed");
  };
}
