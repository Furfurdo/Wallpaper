const timeElement = document.getElementById("time");
const dateElement = document.getElementById("date");
const bgm = document.getElementById("bgm");
const hud = document.getElementById("hud");
const root = document.documentElement;
const body = document.body;
const canvas = document.getElementById("audio-canvas");
const canvasContext = canvas.getContext("2d");
const audioDebug = document.getElementById("audio-debug");
const audioDebugDot = document.getElementById("audio-debug-dot");
const audioDebugText = document.getElementById("audio-debug-text");

let audioUnlockBound = false;
let audioContext;
let mediaElementSource;
let analyserNode;
let analyserData;
let wallpaperAudioTimestamp = 0;
let bgmReady = false;

const bgmEnvelope = Array.isArray(window.__bgmEnvelopeData?.values) ? window.__bgmEnvelopeData.values : [];
const bgmDuration = Number(window.__bgmEnvelopeData?.duration) || 0;
const bgmEnvelopeReady = bgmEnvelope.length > 0 && bgmDuration > 0;

const wallpaperConfig = {
  layout: "left",
  showClock: true,
  accentColor: "rgb(146, 39, 31)",
  audioSensitivity: 120,
  pulseHeight: 88,
  pulseThickness: 16,
  bgmVolume: 35,
  clockLocale: "zh-CN",
  hour12: false,
};

const audioState = {
  spectrum: new Array(64).fill(0),
  bass: 0,
  mid: 0,
  treble: 0,
  targetBass: 0,
  targetMid: 0,
  targetTreble: 0,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === "false" || value === "0" || value === 0) {
    return false;
  }

  return fallback;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseColor(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (/^\d*\.?\d+\s+\d*\.?\d+\s+\d*\.?\d+$/.test(trimmed)) {
    const rgb = trimmed.split(/\s+/).map((channel) => Math.round(clamp(Number(channel), 0, 1) * 255));
    return rgb.length === 3 ? rgb : null;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return hex.split("").map((segment) => Number.parseInt(segment + segment, 16));
    }
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = trimmed.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (rgbMatch) {
    return rgbMatch.slice(1).map((channel) => clamp(Number(channel), 0, 255));
  }

  return null;
}

function applyAccentColor(value) {
  const rgb = parseColor(value);
  if (!rgb) {
    return;
  }

  root.style.setProperty("--accent-r", `${rgb[0]}`);
  root.style.setProperty("--accent-g", `${rgb[1]}`);
  root.style.setProperty("--accent-b", `${rgb[2]}`);
}

function setAudioTargets(spectrum, bass, mid, treble) {
  audioState.spectrum = spectrum;
  audioState.targetBass = clamp(bass, 0, 1.8);
  audioState.targetMid = clamp(mid, 0, 1.6);
  audioState.targetTreble = clamp(treble, 0, 1.5);
}

function updateClock() {
  const now = new Date();
  timeElement.textContent = now.toLocaleTimeString(wallpaperConfig.clockLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: wallpaperConfig.hour12,
  });

  dateElement.textContent = now.toLocaleDateString(wallpaperConfig.clockLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function applyLayout() {
  body.dataset.layout = wallpaperConfig.layout;
  body.dataset.showClock = `${wallpaperConfig.showClock}`;
}

function applyConfig() {
  applyLayout();
  applyAccentColor(wallpaperConfig.accentColor);
  root.style.setProperty("--pulse-height", `${clamp(parseNumber(wallpaperConfig.pulseHeight, 88), 20, 180)}`);
  root.style.setProperty("--pulse-thickness", `${clamp(parseNumber(wallpaperConfig.pulseThickness, 16), 8, 36) / 10}`);
  bgm.volume = clamp(parseNumber(wallpaperConfig.bgmVolume, 35) / 100, 0, 1);
}

function bindParallax() {
  window.addEventListener("mousemove", (event) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const offsetX = ((event.clientX - centerX) / centerX) * 14;
    const offsetY = ((event.clientY - centerY) / centerY) * 14;

    hud.style.setProperty("--mx", `${offsetX.toFixed(2)}px`);
    hud.style.setProperty("--my", `${offsetY.toFixed(2)}px`);
  });

  window.addEventListener("mouseleave", () => {
    hud.style.setProperty("--mx", "0px");
    hud.style.setProperty("--my", "0px");
  });
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGlowBlob(x, y, radius, alpha, accent, coreAlpha = 0.24) {
  const gradient = canvasContext.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(248, 241, 233, ${Math.min(coreAlpha + alpha * 0.6, 0.86)})`);
  gradient.addColorStop(0.24, accent.replace("rgb(", "rgba(").replace(")", `, ${alpha})`));
  gradient.addColorStop(0.78, accent.replace("rgb(", "rgba(").replace(")", `, ${alpha * 0.24})`));
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  canvasContext.beginPath();
  canvasContext.fillStyle = gradient;
  canvasContext.arc(x, y, radius, 0, Math.PI * 2);
  canvasContext.fill();
}

function drawVisualizer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "rgb(146, 39, 31)";
  const rippleSize = clamp(parseNumber(wallpaperConfig.pulseHeight, 88), 20, 180);
  const coronaIntensity = clamp(parseNumber(wallpaperConfig.pulseThickness, 16), 8, 36) / 16;
  const centerX = width * 0.503;
  const centerY = height * 0.515;
  const time = performance.now() * 0.001;
  const bassPulse = Math.pow(audioState.bass, 1.02) * 2.05;
  const midPulse = Math.pow(audioState.mid, 0.98) * 1.9;
  const treblePulse = Math.pow(audioState.treble, 0.94) * 1.8;
  const sunRadius = Math.min(width, height) * 0.082 + rippleSize * 0.22;
  const outerRadius = sunRadius * (1.52 + bassPulse * 0.22);

  canvasContext.clearRect(0, 0, width, height);

  const halo = canvasContext.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius * 1.45);
  halo.addColorStop(0, "rgba(249, 242, 234, 0.12)");
  halo.addColorStop(0.12, accent.replace("rgb(", "rgba(").replace(")", ", 0.24)"));
  halo.addColorStop(0.38, accent.replace("rgb(", "rgba(").replace(")", ", 0.16)"));
  halo.addColorStop(0.7, accent.replace("rgb(", "rgba(").replace(")", ", 0.05)"));
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  canvasContext.beginPath();
  canvasContext.fillStyle = halo;
  canvasContext.arc(centerX, centerY, outerRadius * 1.45, 0, Math.PI * 2);
  canvasContext.fill();

  drawGlowBlob(centerX, centerY, sunRadius * (0.96 + bassPulse * 0.08), 0.34 + bassPulse * 0.08, accent, 0.3);
  drawGlowBlob(centerX, centerY, sunRadius * (0.56 + midPulse * 0.06), 0.18 + midPulse * 0.05, accent, 0.42);

  const spectrum = audioState.spectrum;
  const blobCount = spectrum.length;
  for (let index = 0; index < blobCount; index += 1) {
    const energy = spectrum[index] || 0;
    const angle = (Math.PI * 2 * index) / blobCount - Math.PI / 2 + Math.sin(time * 0.9 + index * 0.4) * 0.012;
    const ripple = Math.sin(time * (1.4 + (index % 5) * 0.07) + index * 0.6) * 5;
    const radius =
      sunRadius * (0.9 + (index % 7) * 0.01) +
      10 +
      energy * (22 + coronaIntensity * 14) +
      bassPulse * 11 +
      ripple;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * 0.94;
    const size = 6 + energy * (12 + coronaIntensity * 4) + bassPulse * 3;
    const alpha = 0.08 + energy * 0.18 + treblePulse * 0.03;
    drawGlowBlob(x, y, size * 2.2, alpha, accent, 0.16);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = time * 0.35 + (Math.PI * 2 * index) / 12;
    const ringRadius = sunRadius * (0.78 + Math.sin(time + index) * 0.03);
    const x = centerX + Math.cos(angle) * ringRadius;
    const y = centerY + Math.sin(angle) * ringRadius * 0.9;
    const size = 10 + bassPulse * 4 + (index % 3) * 2;
    drawGlowBlob(x, y, size * 1.8, 0.08 + bassPulse * 0.03, accent, 0.1);
  }

  const flareCount = 6;
  for (let index = 0; index < flareCount; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / flareCount + Math.sin(time * 0.8 + index) * 0.05;
    const distance = outerRadius * (0.88 + bassPulse * 0.08);
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance * 0.92;
    const size = 18 + midPulse * 7;
    const glow = canvasContext.createRadialGradient(x, y, 0, x, y, size * 2.8);
    glow.addColorStop(0, "rgba(249, 242, 234, 0.12)");
    glow.addColorStop(0.26, accent.replace("rgb(", "rgba(").replace(")", ", 0.12)"));
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    canvasContext.beginPath();
    canvasContext.fillStyle = glow;
    canvasContext.ellipse(x, y, size * 1.8, size, angle, 0, Math.PI * 2);
    canvasContext.fill();
  }
}

function animateAudio() {
  sampleBgmAudio();
  audioState.bass += (audioState.targetBass - audioState.bass) * 0.18;
  audioState.mid += (audioState.targetMid - audioState.mid) * 0.18;
  audioState.treble += (audioState.targetTreble - audioState.treble) * 0.18;

  root.style.setProperty("--bass", audioState.bass.toFixed(3));
  root.style.setProperty("--mid", audioState.mid.toFixed(3));
  root.style.setProperty("--treble", audioState.treble.toFixed(3));

  if (audioDebug && audioDebugDot && audioDebugText) {
    const debugValue = (audioState.bass * 0.55) + (audioState.mid * 0.3) + (audioState.treble * 0.15);
    audioDebugText.textContent = debugValue.toFixed(2);
    audioDebugDot.style.transform = `scale(${(1 + debugValue * 3.2).toFixed(2)})`;
    audioDebugDot.style.opacity = `${Math.min(0.55 + debugValue, 1)}`;
  }

  drawVisualizer();
  window.requestAnimationFrame(animateAudio);
}

function averageRange(values, start, end) {
  let sum = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    sum += values[index] || 0;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function sampleEnvelopeAt(position) {
  if (!bgmEnvelopeReady || bgmEnvelope.length === 0) {
    return 0;
  }

  const clamped = clamp(position, 0, bgmEnvelope.length - 1);
  const index = Math.floor(clamped);
  const nextIndex = Math.min(index + 1, bgmEnvelope.length - 1);
  const mix = clamped - index;
  const current = bgmEnvelope[index] || 0;
  const next = bgmEnvelope[nextIndex] || 0;

  return current + (next - current) * mix;
}

function sampleBgmEnvelope() {
  if (!bgmEnvelopeReady || !Number.isFinite(bgm.currentTime) || bgmDuration <= 0) {
    return;
  }

  const center = (bgm.currentTime / bgmDuration) * (bgmEnvelope.length - 1);
  const windowSpan = 80;
  const waveform = new Array(64);

  for (let index = 0; index < waveform.length; index += 1) {
    const progress = index / (waveform.length - 1);
    const samplePosition = center + (progress - 0.5) * windowSpan;
    waveform[index] = clamp(sampleEnvelopeAt(samplePosition) * 1.8, 0, 1.7);
  }

  const current = sampleEnvelopeAt(center);
  const near = sampleEnvelopeAt(center + 3);
  const far = sampleEnvelopeAt(center + 11);
  const transient = Math.abs(current - near);

  setAudioTargets(
    waveform,
    current * 2 + transient * 0.75,
    ((current + near + far) / 3) * 1.5,
    Math.abs(near - far) * 4.4 + transient * 0.9,
  );
}

function wallpaperAudioListener(audioArray) {
  if (!audioArray || audioArray.length < 128) {
    return;
  }

  const merged = new Array(64);
  const responseGain = clamp(parseNumber(wallpaperConfig.audioSensitivity, 120) / 100, 0.2, 3);
  for (let index = 0; index < 64; index += 1) {
    const left = Math.min(audioArray[index] || 0, 1);
    const right = Math.min(audioArray[index + 64] || 0, 1);
    merged[index] = clamp((left + right) * 0.5 * responseGain, 0, 1.6);
  }

  setAudioTargets(
    merged,
    averageRange(merged, 0, 8),
    averageRange(merged, 8, 24),
    averageRange(merged, 24, 48),
  );
  wallpaperAudioTimestamp = performance.now();
}

function initAudioAnalysis() {
  if (audioContext || typeof window.AudioContext === "undefined") {
    return;
  }

  audioContext = new window.AudioContext();
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.82;
  analyserData = new Uint8Array(analyserNode.frequencyBinCount);
  mediaElementSource = audioContext.createMediaElementSource(bgm);
  mediaElementSource.connect(analyserNode);
  analyserNode.connect(audioContext.destination);
}

function sampleBgmAudio() {
  sampleBgmEnvelope();

  if (!analyserNode || !analyserData) {
    return;
  }

  if (!bgmReady || performance.now() - wallpaperAudioTimestamp < 120) {
    return;
  }

  analyserNode.getByteFrequencyData(analyserData);
  const responseGain = clamp(parseNumber(wallpaperConfig.audioSensitivity, 120) / 100, 0.2, 3);
  const spectrum = new Array(64);

  for (let index = 0; index < 64; index += 1) {
    const raw = (analyserData[index] || 0) / 255;
    spectrum[index] = clamp(raw * responseGain * 1.8, 0, 1.7);
  }

  setAudioTargets(
    spectrum,
    averageRange(spectrum, 0, 8) * 1.7,
    averageRange(spectrum, 8, 24) * 1.45,
    averageRange(spectrum, 24, 48) * 1.3,
  );
}

function applyUserProperty(properties, key, handler) {
  if (properties[key]) {
    handler(properties[key].value, properties[key]);
  }
}

window.wallpaperPropertyListener = {
  applyUserProperties(properties) {
    applyUserProperty(properties, "layoutmode", (value) => {
      wallpaperConfig.layout = ["left", "right", "center"].includes(value) ? value : wallpaperConfig.layout;
    });
    applyUserProperty(properties, "showclock", (value) => {
      wallpaperConfig.showClock = parseBoolean(value, wallpaperConfig.showClock);
    });
    applyUserProperty(properties, "accentcolor", (value) => {
      wallpaperConfig.accentColor = value;
    });
    applyUserProperty(properties, "audiosensitivity", (value) => {
      wallpaperConfig.audioSensitivity = parseNumber(value, wallpaperConfig.audioSensitivity);
    });
    applyUserProperty(properties, "pulseheight", (value) => {
      wallpaperConfig.pulseHeight = parseNumber(value, wallpaperConfig.pulseHeight);
    });
    applyUserProperty(properties, "pulsethickness", (value) => {
      wallpaperConfig.pulseThickness = parseNumber(value, wallpaperConfig.pulseThickness);
    });
    applyUserProperty(properties, "bgmvolume", (value) => {
      wallpaperConfig.bgmVolume = parseNumber(value, wallpaperConfig.bgmVolume);
    });

    applyConfig();
    requestBgmPlayback();
  },
};

function requestBgmPlayback() {
  bgm.muted = false;
  bgm.volume = clamp(parseNumber(wallpaperConfig.bgmVolume, 35) / 100, 0, 1);
  bgmReady = true;
  initAudioAnalysis();
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  const playPromise = bgm.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function bindAudioUnlock() {
  if (audioUnlockBound) {
    return;
  }

  audioUnlockBound = true;
  const unlock = () => {
    initAudioAnalysis();
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    requestBgmPlayback();
  };

  bgm.addEventListener("canplay", unlock);
  bgm.addEventListener("loadeddata", unlock);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unlock();
    }
  });

  ["pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, unlock, { passive: true });
  });
}

applyConfig();
updateClock();
setInterval(updateClock, 1000);
bindParallax();
resizeCanvas();
animateAudio();
bindAudioUnlock();
bgm.addEventListener("play", () => {
  bgmReady = true;
});

window.addEventListener("resize", resizeCanvas);

if (typeof window.wallpaperRegisterAudioListener === "function") {
  window.wallpaperRegisterAudioListener(wallpaperAudioListener);
}

requestBgmPlayback();
