const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

/* ===========================
   STATE
=========================== */

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
let finalCents = null;

/* ===========================
   NOTE SETS
=========================== */

const CHROMATIC = [58,59,60,61,62,63,64,65,66,67,68,69,70];
const BB_MAJOR  = [58,60,62,63,65,67,69,70];

let currentNoteSet = BB_MAJOR;

/* ===========================
   UTILITIES
=========================== */

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const names = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
  return names[midi % 12];
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
   AUDIO
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

function resetDisplay() {
  document.getElementById("feedback").innerText = "🎺 Speel de noot";
  document.getElementById("feedback").className = "feedback";
  document.getElementById("arrow").innerText = "";
  document.getElementById("centsDisplay").innerText = "---";
}

function showMissedNote() {

  const feedback = document.getElementById("feedback");
  const arrow = document.getElementById("arrow");
  const noteName = midiToNoteName(currentTargetMidi);

  feedback.innerHTML =
    `No stable tone detected<br><span class="answerNote">${noteName}</span>`;

  feedback.className = "feedback bad";
  arrow.innerText = "✖";
  arrow.className = "arrow center";
}

function playLoop() {
  if (!isPlaying) return;

  const midi = getRandomNote();
  currentTargetMidi = midi;

  noteAlreadyScored = false;
  stableCount = 0;
  lastCents = null;
  finalCents = null;

  // Reset display alleen bij START nieuwe noot
  resetDisplay();

  playTone(midiToFreq(midi), noteDuration);

  // Feedback moment aan einde pauze
  setTimeout(() => {
    if (!realtimeFeedback) {
      if (finalCents !== null) {
        showFinalFeedback(finalCents);
      } else {
        showMissedNote();
      }
    }
  }, noteDuration + selectedDelay);

  // Wacht EXTRA tijd zodat feedback zichtbaar blijft
  setTimeout(() => {
    playLoop();
  }, noteDuration + selectedDelay + 800); 
  // 👈 800ms extra zichtbare feedback tijd
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
    if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
  }

  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
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

    const cents = centsOff(adjusted, midiToFreq(currentTargetMidi));
    lastCents = cents;
    finalCents = cents;

    if (realtimeFeedback) {
      document.getElementById("centsDisplay").innerText =
        "Deviation: " + cents.toFixed(1) + " cents";
      showRealtimeFeedback(cents);
    }

    if (Math.abs(cents) < 40) stableCount++;
    else stableCount = 0;

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
  showFeedback(cents, false);
}

function showFinalFeedback(cents) {
  showFeedback(cents, true);
}

function showFeedback(cents, showNote) {

  const feedback = document.getElementById("feedback");
  const arrow = document.getElementById("arrow");
  const noteName = midiToNoteName(currentTargetMidi);

  const abs = Math.abs(cents);

  let text = "";
  let className = "";
  let arrowSymbol = "";
  let arrowClass = "";

  if (abs < 10) {
    text = "Perfect 🎯";
    className = "feedback good";
    arrowSymbol = "✔";
    arrowClass = "arrow center";
  }
  else if (abs < 25) {
    text = "Close 👍";
    className = "feedback ok";
    arrowSymbol = "•";
    arrowClass = "arrow center";
  }
  else {
    const high = cents > 0;
    text = high ? "Too High" : "Too Low";
    className = "feedback bad";
    arrowSymbol = high ? "⬆" : "⬇";
    arrowClass = high ? "arrow up" : "arrow down";
  }

  if (showNote) {
    feedback.innerHTML = `${text}<br><span class="answerNote">${noteName}</span>`;
  } else {
    feedback.innerText = text;
  }

  feedback.className = className;
  arrow.innerText = arrowSymbol;
  arrow.className = arrowClass;
}

function updateScore(cents) {
  const abs = Math.abs(cents);

  if (abs < 10) { score += 2; streak++; }
  else if (abs < 25) { score += 1; streak++; }
  else { streak = 0; }

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

  if (pitchAnimationId) cancelAnimationFrame(pitchAnimationId);
  pitchAnimationId = null;

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  analyser = null;
  microphone = null;
}

/* ===========================
   DOM READY
=========================== */

document.addEventListener("DOMContentLoaded", () => {

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

  document.querySelectorAll(".speedBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDelay = parseInt(btn.dataset.delay);
      document.querySelectorAll(".speedBtn")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("currentSpeed").innerText =
        (selectedDelay / 1000) + " sec";
    });
  });

  document.querySelectorAll(".lengthBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      noteDuration = parseInt(btn.dataset.length);
      document.querySelectorAll(".lengthBtn")
        .forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("currentLength").innerText =
        (noteDuration / 1000).toFixed(1) + " sec";
    });
  });

  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener("change", function() {
      currentNoteSet = this.value === "scale" ? BB_MAJOR : CHROMATIC;
    });
  });

});