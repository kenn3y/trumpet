const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let isPlaying = false;
let lastNote = null;
let selectedDelay = 2000;
let noteDuration = 1000;

let pitchAnimationId = null;
let micStream = null;
let analyser = null;
let microphone = null;
let dataArray = null;

let score = 0;
let streak = 0;
let noteAlreadyScored = false;

let stableCount = 0;
let lastCents = null;

let realtimeFeedback = true;
let currentTargetMidi = null;

/* ===========================
   NOTE SETS
=========================== */

const CHROMATIC = [58,59,60,61,62,63,64,65,66,67,68,69,70];

const BB_MAJOR = [
  58, 60, 62, 63,
  65, 67, 69, 70
];

let currentNoteSet = BB_MAJOR;

/* ===========================
   UTILITIES
=========================== */

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const noteNames = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
  return noteNames[midi % 12];
}

function centsOff(measured, target) {
  return 1200 * Math.log2(measured / target);
}

function getRandomNote() {
  let note;
  do {
    note = currentNoteSet[Math.floor(Math.random() * currentNoteSet.length)];
  } while (note === lastNote);
  lastNote = note;
  return note;
}

/* ===========================
   AUDIO PLAYBACK
=========================== */

function playTone(freq, durationMs) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "triangle";
  osc.frequency.value = freq;

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  gain.gain.setValueAtTime(0.2, audioCtx.currentTime);

  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

function playLoop() {
  if (!isPlaying) return;

  const midi = getRandomNote();
  currentTargetMidi = midi;
  noteAlreadyScored = false;

  // Blind mode → toon vorige evaluatie
  if (!realtimeFeedback && lastCents !== null) {
    showFinalFeedback(lastCents);
  }

  playTone(midiToFreq(midi), noteDuration);

  setTimeout(() => {
    playLoop();
  }, noteDuration + selectedDelay);
}

/* ===========================
   MICROPHONE
=========================== */

async function initMicrophone() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  dataArray = new Float32Array(analyser.fftSize);

  microphone = audioCtx.createMediaStreamSource(micStream);
  microphone.connect(analyser);
}

/* ===========================
   PITCH DETECTION
=========================== */

function autoCorrelate(buffer, sampleRate) {
  let SIZE = buffer.length;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }

  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

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
      c[i] += buffer[j] * buffer[j + i];
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

  return sampleRate / maxpos;
}

function detectPitch() {
  if (!analyser) {
    pitchAnimationId = requestAnimationFrame(detectPitch);
    return;
  }

  analyser.getFloatTimeDomainData(dataArray);
  const freq = autoCorrelate(dataArray, audioCtx.sampleRate);

  if (freq !== -1 && currentTargetMidi !== null) {

    let adjusted = freq;

    while (adjusted > 500) adjusted /= 2;
    while (adjusted < 200) adjusted *= 2;

    if (adjusted < 220 || adjusted > 480) {
      pitchAnimationId = requestAnimationFrame(detectPitch);
      return;
    }

    const targetFreq = midiToFreq(currentTargetMidi);
    const cents = centsOff(adjusted, targetFreq);
    lastCents = cents;

    if (realtimeFeedback) {
      document.getElementById("centsDisplay").innerText =
        "Deviation: " + cents.toFixed(1) + " cents";

      showRealtimeFeedback(cents);
    }

    // Stabiliteit
    if (Math.abs(cents) < 40) {
      stableCount++;
    } else {
      stableCount = 0;
    }

    if (stableCount > 3 && !noteAlreadyScored) {
      updateScore(cents);
      noteAlreadyScored = true;
    }
  }

  pitchAnimationId = requestAnimationFrame(detectPitch);
}

/* ===========================
   FEEDBACK
=========================== */

function showRealtimeFeedback(cents) {
  const feedback = document.getElementById("feedback");
  const arrow = document.getElementById("arrow");
  const noteName = midiToNoteName(currentTargetMidi);
  const abs = Math.abs(cents);

  if (abs < 10) {
    feedback.innerHTML = "Perfect 🎯<br><span class='answerNote'>" + noteName + "</span>";
    feedback.className = "feedback good";
    arrow.innerText = "✔";
    arrow.className = "arrow center";
  }
  else if (abs < 25) {
    feedback.innerHTML = "Close 👍<br><span class='answerNote'>" + noteName + "</span>";
    feedback.className = "feedback ok";
    arrow.innerText = "•";
    arrow.className = "arrow center";
  }
  else {
    const high = cents > 0;
    feedback.innerHTML =
      (high ? "Too High" : "Too Low") +
      "<br><span class='answerNote'>" + noteName + "</span>";
    feedback.className = "feedback bad";
    arrow.innerText = high ? "⬆" : "⬇";
    arrow.className = high ? "arrow up" : "arrow down";
  }
}

function showFinalFeedback(cents) {
  showRealtimeFeedback(cents);
}

function updateScore(cents) {
  const abs = Math.abs(cents);

  if (abs < 10) {
    score += 2;
    streak++;
  }
  else if (abs < 25) {
    score += 1;
    streak++;
  }
  else {
    streak = 0;
  }

  document.getElementById("score").innerText = score;
  document.getElementById("streak").innerText = streak;
}

/* ===========================
   GAME CONTROL
=========================== */

function startGame() {
  if (isPlaying) return;
  isPlaying = true;
  document.getElementById("status").innerText = "Playing";
  playLoop();
}

function stopGame() {
  isPlaying = false;
  document.getElementById("status").innerText = "Stopped";

  if (pitchAnimationId) {
    cancelAnimationFrame(pitchAnimationId);
    pitchAnimationId = null;
  }

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  analyser = null;
  microphone = null;
}

/* ===========================
   EVENT LISTENERS
=========================== */

document.getElementById("startBtn").addEventListener("click", async () => {
  await audioCtx.resume();
  if (!micStream) await initMicrophone();
  startGame();
  detectPitch();
});

document.getElementById("stopBtn").addEventListener("click", stopGame);

document.getElementById("realtimeToggle")
  .addEventListener("change", function() {
    realtimeFeedback = this.checked;
});

document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", function() {
    currentNoteSet = this.value === "scale" ? BB_MAJOR : CHROMATIC;
  });
});