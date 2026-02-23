const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let isPlaying = false;
let lastNote = null;
let selectedDelay = 2000; // default 2 sec
let noteDuration = 1000; // 1.0 sec

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
  const freq = midiToFreq(midi);

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

document.getElementById("startBtn").addEventListener("click", () => {
  audioCtx.resume();
  startGame();
});

document.getElementById("stopBtn").addEventListener("click", stopGame);