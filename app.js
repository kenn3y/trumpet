const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let isPlaying = false;
let lastNote = null;
let selectedDelay = 2000; // default 2 sec
let noteDuration = 1000; // 1.0 sec
let pitchAnimationId = null;
let micStream = null;
let score = 0;
let noteAlreadyScored = false;
let stableCount = 0;
let lastCents = null;
let streak = 0;
let realtimeFeedback = true;

// Bb3 (58) tot Bb4 (70)
const MIN_MIDI = 58;
const MAX_MIDI = 70;

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getRandomNote() {
  let note;
  do {
    note = Math.floor(Math.random() * (MAX_MIDI - MIN_MIDI + 1)) + MIN_MIDI;
  } while (note === lastNote);
  lastNote = note;
  return note;
}

function playTone(freq, durationMs) {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.value = freq;

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + durationMs / 1000);
}

function playLoop() {
    if (!isPlaying) return;
  
    const midi = getRandomNote();
    currentTargetMidi = midi;
    noteAlreadyScored = false; // reset scoring voor nieuwe noot
  
    const freq = midiToFreq(midi);
    if (!realtimeFeedback && lastCents !== null) {

        const feedback = document.getElementById("feedback");
        const arrow = document.getElementById("arrow");

        document.getElementById("centsDisplay").innerText =
  "Deviation: " + lastCents.toFixed(1) + " cents";
      
        if (Math.abs(lastCents) < 10) {
          feedback.innerText = "Perfect 🎯";
          feedback.className = "feedback good";
          arrow.innerText = "✔";
          arrow.className = "arrow center";
      
        } else if (Math.abs(lastCents) < 25) {
          feedback.innerText = "Close 👍";
          feedback.className = "feedback ok";
          arrow.innerText = "•";
          arrow.className = "arrow center";
      
        } else {
          if (lastCents > 0) {
            feedback.innerText = "Too High";
            feedback.className = "feedback bad";
            arrow.innerText = "⬆";
            arrow.className = "arrow up";
          } else {
            feedback.innerText = "Too Low";
            feedback.className = "feedback bad";
            arrow.innerText = "⬇";
            arrow.className = "arrow down";
          }
        }
      
      }
    playTone(freq, noteDuration);
  
    setTimeout(() => {
      playLoop();
    }, noteDuration + selectedDelay);
  }

function startGame() {
  if (isPlaying) return;
  isPlaying = true;
  document.getElementById("status").innerText = "Playing";
  playLoop();
}

function stopGame() {
    isPlaying = false;
  
    document.getElementById("status").innerText = "Stopped";
  
    // Stop pitch detection loop
    if (pitchAnimationId) {
      cancelAnimationFrame(pitchAnimationId);
      pitchAnimationId = null;
    }
  
    // Stop microphone stream
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
  
    // console.log("Microphone stopped");
  }


document.querySelectorAll(".speedBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDelay = parseInt(btn.dataset.delay);
  
      document.querySelectorAll(".speedBtn").forEach(b =>
        b.classList.remove("active")
      );
  
      btn.classList.add("active");
  
      document.getElementById("currentSpeed").innerText =
        (selectedDelay / 1000) + " sec";
    });
  });

  document.querySelectorAll(".lengthBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      noteDuration = parseInt(btn.dataset.length);
  
      document.querySelectorAll(".lengthBtn").forEach(b =>
        b.classList.remove("active")
      );
  
      btn.classList.add("active");
  
      document.getElementById("currentLength").innerText =
        (noteDuration / 1000).toFixed(1) + " sec";
    });
  });


document.getElementById("stopBtn").addEventListener("click", stopGame);

let analyser;
let microphone;
let dataArray;
let bufferLength;

async function initMicrophone() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  
    microphone = audioCtx.createMediaStreamSource(micStream);
  
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
  
    bufferLength = analyser.fftSize;
    dataArray = new Float32Array(bufferLength);
  
    microphone.connect(analyser);
  
    // console.log("Microphone initialized");
  }

function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;
    let rms = 0;
  
    for (let i = 0; i < SIZE; i++) {
      let val = buffer[i];
      rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
  
    if (rms < 0.01) return -1; // too quiet
  
    let r1 = 0, r2 = SIZE - 1;
    let threshold = 0.2;
  
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) {
        r1 = i;
        break;
      }
    }
  
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buffer[SIZE - i]) < threshold) {
        r2 = SIZE - i;
        break;
      }
    }
  
    buffer = buffer.slice(r1, r2);
    SIZE = buffer.length;
  
    let c = new Array(SIZE).fill(0);
  
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE - i; j++) {
        c[i] = c[i] + buffer[j] * buffer[j + i];
      }
    }
  
    let d = 0;
    while (c[d] > c[d + 1]) d++;
  
    let maxval = -1;
    let maxpos = -1;
  
    for (let i = d; i < SIZE; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }
  
    let T0 = maxpos;
  
    return sampleRate / T0;
  }

  function detectPitch() {
    // console.log("detect loop running");
  
    if (!analyser) {
      pitchAnimationId = requestAnimationFrame(detectPitch);
      return;
    }
  
    analyser.getFloatTimeDomainData(dataArray);
    const freq = autoCorrelate(dataArray, audioCtx.sampleRate);
  

    if (freq !== -1 && currentTargetMidi !== null) {

        // === 1️⃣ Octaaf normalisatie ===
        let adjustedFreq = freq;
      
        while (adjustedFreq > 500) adjustedFreq /= 2;
        while (adjustedFreq < 200) adjustedFreq *= 2;
      
        // === 2️⃣ Trompet bereik filter ===
        if (adjustedFreq < 220 || adjustedFreq > 480) {
          pitchAnimationId = requestAnimationFrame(detectPitch);
          return;
        }
      
        const targetFreq = midiToFreq(currentTargetMidi);
        const cents = centsOff(adjustedFreq, targetFreq);
      
        if (realtimeFeedback) {
            document.getElementById("centsDisplay").innerText =
              "Deviation: " + cents.toFixed(1) + " cents";
          }
      
        const feedback = document.getElementById("feedback");
        const arrow = document.getElementById("arrow");
      
        // === 3️⃣ Stabiliteitscontrole ===
        if (Math.abs(cents) < 40) {
          if (lastCents !== null && Math.abs(cents - lastCents) < 5) {
            stableCount++;
          } else {
            stableCount = 0;
          }
        } else {
          stableCount = 0;
        }
      
        lastCents = cents;

        if (realtimeFeedback) {

            if (Math.abs(cents) < 10) {
              feedback.innerText = "Perfect 🎯";
              feedback.className = "feedback good";
              arrow.innerText = "✔";
              arrow.className = "arrow center";
          
            } else if (Math.abs(cents) < 25) {
              feedback.innerText = "Close 👍";
              feedback.className = "feedback ok";
              arrow.innerText = "•";
              arrow.className = "arrow center";
          
            } else {
              if (cents > 0) {
                feedback.innerText = "Too High";
                feedback.className = "feedback bad";
                arrow.innerText = "⬆";
                arrow.className = "arrow up";
              } else {
                feedback.innerText = "Too Low";
                feedback.className = "feedback bad";
                arrow.innerText = "⬇";
                arrow.className = "arrow down";
              }
            }
          
          }
        
          if (stableCount > 3 && !noteAlreadyScored) {

            if (Math.abs(cents) < 10) {
              score += 2;
              streak += 1;
          
            } else if (Math.abs(cents) < 25) {
              score += 1;
              streak += 1;
          
            } else {
              streak = 0;
            }
          
            document.getElementById("score").innerText = score;
            document.getElementById("streak").innerText = streak;
          
            noteAlreadyScored = true;
          }
      }

    pitchAnimationId = requestAnimationFrame(detectPitch);
  }

  document.getElementById("startBtn").addEventListener("click", async () => {
    await audioCtx.resume();
  
    if (!analyser) {
      await initMicrophone();
    }
  
    startGame();        // eerst game starten (isPlaying = true)
    detectPitch();      // daarna pitch detectie starten
  });

  document.getElementById("realtimeToggle")
  .addEventListener("change", function() {
    realtimeFeedback = this.checked;
});

  function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / 440);
  }

  function centsOff(measuredFreq, targetFreq) {
    return 1200 * Math.log2(measuredFreq / targetFreq);
  }

  let currentTargetMidi = null;