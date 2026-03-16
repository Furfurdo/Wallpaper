const timeElement = document.getElementById("time");
const dateElement = document.getElementById("date");
const customTitleElement = document.getElementById("custom-title");
const customSubtitleElement = document.getElementById("custom-subtitle");
const customKickerElement = document.getElementById("custom-kicker");
const titleBlockElement = document.getElementById("title-block");
const bgm = document.getElementById("bgm");
const hud = document.getElementById("hud");
const root = document.documentElement;
const body = document.body;
const canvas = document.getElementById("audio-canvas");
const canvasContext = canvas.getContext("2d");
const waterHalo = document.querySelector(".water-halo");
const featherImage = new Image();
featherImage.src = "assets/feather.svg";

let audioUnlockBound = false;
let audioContext;
let mediaElementSource;
let analyserNode;
let analyserData;
let wallpaperAudioTimestamp = 0;
let bgmReady = false;
let lastFeatherSpawn = 0;

const featherParticles = [];
const pointerState = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.5,
  active: false,
  hasMoved: false,
};

const bgmEnvelope = Array.isArray(window.__bgmEnvelopeData?.values) ? window.__bgmEnvelopeData.values : [];
const bgmDuration = Number(window.__bgmEnvelopeData?.duration) || 0;
const bgmEnvelopeReady = bgmEnvelope.length > 0 && bgmDuration > 0;

const TITLE_PLACEHOLDER = "\u745e\u9e64\u4ed9";
const SUBTITLE_PLACEHOLDER = "\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a";
const KICKER_PLACEHOLDER = "RUI HE XIAN";

const wallpaperConfig = {
  showClock: true,
  clockScale: 100,
  clockOffsetX: 0,
  clockOffsetY: 0,
  clockOpacity: 92,
  customTitle: TITLE_PLACEHOLDER,
  customSubtitle: SUBTITLE_PLACEHOLDER,
  customKicker: KICKER_PLACEHOLDER,
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

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now).toUpperCase();
  const year = `${now.getFullYear()}`;
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  dateElement.textContent = `${weekday}  /  ${year} . ${month} . ${day}`;
}

function applyLayout() {
  body.dataset.showClock = `${wallpaperConfig.showClock}`;
}

function applyConfig() {
  applyLayout();
  applyAccentColor(wallpaperConfig.accentColor);
  root.style.setProperty("--pulse-height", `${clamp(parseNumber(wallpaperConfig.pulseHeight, 88), 20, 180)}`);
  root.style.setProperty("--pulse-thickness", `${clamp(parseNumber(wallpaperConfig.pulseThickness, 16), 8, 36) / 10}`);
  root.style.setProperty("--clock-scale", `${clamp(parseNumber(wallpaperConfig.clockScale, 100), 60, 180) / 100}`);
  root.style.setProperty("--clock-offset-x", `${clamp(parseNumber(wallpaperConfig.clockOffsetX, 0), -600, 600)}px`);
  root.style.setProperty("--clock-offset-y", `${clamp(parseNumber(wallpaperConfig.clockOffsetY, 0), -400, 400)}px`);
  root.style.setProperty("--clock-opacity", `${clamp(parseNumber(wallpaperConfig.clockOpacity, 92), 10, 100) / 100}`);
  bgm.volume = clamp(parseNumber(wallpaperConfig.bgmVolume, 35) / 100, 0, 1);
  const titleText = `${wallpaperConfig.customTitle || ""}`.trim() || TITLE_PLACEHOLDER;
  const subtitleText = `${wallpaperConfig.customSubtitle || ""}`.trim() || SUBTITLE_PLACEHOLDER;
  const kickerText = `${wallpaperConfig.customKicker || ""}`.trim() || KICKER_PLACEHOLDER;

  if (customTitleElement) {
    customTitleElement.textContent = titleText;
    customTitleElement.setAttribute("data-text", titleText);
    customTitleElement.style.display = "block";
  }

  if (customSubtitleElement) {
    customSubtitleElement.textContent = subtitleText;
    customSubtitleElement.style.display = subtitleText ? "block" : "none";
  }

  if (customKickerElement) {
    customKickerElement.textContent = kickerText;
    customKickerElement.style.display = kickerText ? "block" : "none";
  }

  if (titleBlockElement) {
    titleBlockElement.style.display = titleText || subtitleText || kickerText ? "flex" : "none";
  }
}

function bindParallax() {
  window.addEventListener("mousemove", (event) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const offsetX = ((event.clientX - centerX) / centerX) * 14;
    const offsetY = ((event.clientY - centerY) / centerY) * 14;

    hud.style.setProperty("--mx", `${offsetX.toFixed(2)}px`);
    hud.style.setProperty("--my", `${offsetY.toFixed(2)}px`);

    if (pointerState.hasMoved) {
      spawnFeathers(pointerState.x, pointerState.y, event.clientX, event.clientY);
    }

    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.active = true;
    pointerState.hasMoved = true;
  });

  window.addEventListener("mouseleave", () => {
    hud.style.setProperty("--mx", "0px");
    hud.style.setProperty("--my", "0px");
    pointerState.active = false;
    pointerState.hasMoved = false;
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

function drawRippleRing(centerX, centerY, baseRadius, amplitude, thickness, alpha, accent, spectrum, phase, rotation = 0) {
  const pointCount = 80;
  const verticalScale = 0.93;

  canvasContext.beginPath();
  for (let index = 0; index <= pointCount; index += 1) {
    const progress = index / pointCount;
    const angle = progress * Math.PI * 2 + rotation;
    const spectrumIndex = Math.floor(progress * (spectrum.length - 1));
    const energy = spectrum[spectrumIndex] || 0;
    const organicWave =
      Math.sin(angle * 2.4 + phase) * amplitude * 0.16 +
      Math.sin(angle * 5.2 - phase * 1.2) * amplitude * 0.08;
    const audioWave = energy * amplitude * (0.34 + Math.sin(phase + progress * 11) * 0.08);
    const radius = baseRadius + organicWave + audioWave;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius * verticalScale;

    if (index === 0) {
      canvasContext.moveTo(x, y);
    } else {
      canvasContext.lineTo(x, y);
    }
  }

  canvasContext.closePath();
  canvasContext.lineWidth = thickness;
  canvasContext.strokeStyle = accent.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  canvasContext.shadowBlur = 18 + amplitude * 0.28;
  canvasContext.shadowColor = accent.replace("rgb(", "rgba(").replace(")", `, ${alpha * 0.44})`);
  canvasContext.lineJoin = "round";
  canvasContext.lineCap = "round";
  canvasContext.stroke();
}

function spawnFeathers(fromX, fromY, toX, toY) {
  const now = performance.now();
  if (now - lastFeatherSpawn < 220) {
    return;
  }

  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (distance < 18) {
    return;
  }

  lastFeatherSpawn = now;
  const count = 1;

  for (let index = 0; index < count; index += 1) {
    if (featherParticles.length >= 4) {
      break;
    }

    const lag = 0.28 + Math.random() * 0.18;
    const trailX = toX - dx * lag;
    const trailY = toY - dy * lag;

    featherParticles.push({
      x: trailX + (Math.random() - 0.5) * 12,
      y: trailY + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 0.45 + Math.random() * 0.7,
      drift: (Math.random() - 0.5) * 0.26,
      rotation: (Math.random() > 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.58,
      spin: (Math.random() - 0.5) * 0.008,
      size: 32 + Math.random() * 18,
      life: 0,
      maxLife: 72 + Math.random() * 28,
      alpha: 0.28 + Math.random() * 0.14,
    });
  }

  if (featherParticles.length > 4) {
    featherParticles.splice(0, featherParticles.length - 4);
  }
}

function drawFeatherParticle(particle) {
  const lifeProgress = particle.life / particle.maxLife;
  const fade = 1 - lifeProgress;
  const alpha = particle.alpha * fade;

  canvasContext.save();
  canvasContext.translate(particle.x, particle.y);
  canvasContext.rotate(particle.rotation);
  canvasContext.scale(1, 1 + fade * 0.06);
  canvasContext.globalAlpha = alpha;
  canvasContext.shadowBlur = 12;
  canvasContext.shadowColor = "rgba(0, 0, 0, 0.24)";

  if (featherImage.complete) {
    const drawWidth = particle.size * 3.1;
    const drawHeight = particle.size * 1.22;
    canvasContext.drawImage(featherImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    canvasContext.globalCompositeOperation = "source-atop";
    canvasContext.fillStyle = "rgba(6, 5, 6, 1)";
    canvasContext.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    canvasContext.globalCompositeOperation = "source-over";
  } else {
    canvasContext.fillStyle = "rgba(10, 9, 10, 0.94)";
    canvasContext.beginPath();
    canvasContext.moveTo(0, -particle.size * 0.95);
    canvasContext.quadraticCurveTo(particle.size * 0.55, -particle.size * 0.2, particle.size * 0.18, particle.size * 0.92);
    canvasContext.quadraticCurveTo(-particle.size * 0.65, particle.size * 0.22, 0, -particle.size * 0.95);
    canvasContext.fill();
  }

  canvasContext.restore();
}

function updateAndDrawFeathers() {
  for (let index = featherParticles.length - 1; index >= 0; index -= 1) {
    const particle = featherParticles[index];
    particle.life += 1;
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vx += particle.drift * 0.02;
    particle.vy += 0.008;
    particle.rotation += particle.spin;

    if (particle.life >= particle.maxLife || particle.y > window.innerHeight + 48) {
      featherParticles.splice(index, 1);
      continue;
    }

    drawFeatherParticle(particle);
  }
}

function drawVisualizer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "rgb(146, 39, 31)";
  const rippleSize = clamp(parseNumber(wallpaperConfig.pulseHeight, 88), 20, 180);
  const rippleIntensity = clamp(parseNumber(wallpaperConfig.pulseThickness, 16), 8, 36) / 16;
  const centerX = width * 0.503;
  const time = performance.now() * 0.001;
  const bassPulse = Math.pow(audioState.bass, 1.02) * 1.9;
  const midPulse = Math.pow(audioState.mid, 0.98) * 1.6;
  const treblePulse = Math.pow(audioState.treble, 0.94) * 1.35;
  const sunRadius = Math.min(width, height) * 0.076 + rippleSize * 0.2;
  const centerY = height * 0.515 + sunRadius * 2.6;
  const outerRadius = sunRadius * (1.46 + bassPulse * 0.18);
  const rippleAmplitude = 20 + rippleSize * 0.12 + bassPulse * 18 + treblePulse * 8;

  canvasContext.clearRect(0, 0, width, height);

  if (waterHalo) {
    waterHalo.style.left = `${centerX}px`;
    waterHalo.style.top = `${centerY}px`;
    waterHalo.style.width = `${outerRadius * 2.9}px`;
  }
  const axisX = centerX;
  const clockX = axisX;
  const clockY = height * 0.31;
  root.style.setProperty("--axis-x", `${axisX}px`);
  root.style.setProperty("--clock-x", `${clockX}px`);
  root.style.setProperty("--clock-y", `${clockY}px`);

  const halo = canvasContext.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius * 1.45);
  halo.addColorStop(0, "rgba(249, 242, 234, 0.06)");
  halo.addColorStop(0.12, accent.replace("rgb(", "rgba(").replace(")", ", 0.16)"));
  halo.addColorStop(0.38, accent.replace("rgb(", "rgba(").replace(")", ", 0.1)"));
  halo.addColorStop(0.7, accent.replace("rgb(", "rgba(").replace(")", ", 0.03)"));
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  canvasContext.beginPath();
  canvasContext.fillStyle = halo;
  canvasContext.arc(centerX, centerY, outerRadius * 1.45, 0, Math.PI * 2);
  canvasContext.fill();

  const rippleBase = sunRadius * 1.04;
  const spectrum = audioState.spectrum;
  const rings = [
    {
      radius: rippleBase + bassPulse * 10,
      amplitude: rippleAmplitude * 0.9,
      thickness: 3.2 + rippleIntensity * 0.8,
      alpha: 0.24 + bassPulse * 0.04,
      phase: time * 1.25,
      rotation: time * 0.02,
    },
    {
      radius: rippleBase + 34 + bassPulse * 14 + midPulse * 4,
      amplitude: rippleAmplitude * 1.08,
      thickness: 2.8 + rippleIntensity * 0.65,
      alpha: 0.18 + midPulse * 0.04,
      phase: time * 1.08 + 1.4,
      rotation: -time * 0.018,
    },
    {
      radius: rippleBase + 70 + bassPulse * 18 + treblePulse * 8,
      amplitude: rippleAmplitude * 1.16,
      thickness: 2.2 + rippleIntensity * 0.55,
      alpha: 0.14 + treblePulse * 0.03,
      phase: time * 0.96 + 2.2,
      rotation: time * 0.014,
    },
  ];

  rings.forEach((ring) => {
    drawRippleRing(
      centerX,
      centerY,
      ring.radius,
      ring.amplitude,
      ring.thickness,
      ring.alpha,
      accent,
      spectrum,
      ring.phase,
      ring.rotation,
    );
  });

  const dropletCount = 10;
  for (let index = 0; index < dropletCount; index += 1) {
    const angle = time * 0.28 + (Math.PI * 2 * index) / dropletCount;
    const distance = rippleBase + 52 + bassPulse * 20 + Math.sin(time * 1.2 + index * 0.7) * 8;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance * 0.93;
    const size = 7 + treblePulse * 4 + (index % 3);
    drawGlowBlob(x, y, size * 1.6, 0.07 + treblePulse * 0.03, accent, 0.08);
  }

  canvasContext.shadowBlur = 0;
  updateAndDrawFeathers();
}

function animateAudio() {
  sampleBgmAudio();
  audioState.bass += (audioState.targetBass - audioState.bass) * 0.18;
  audioState.mid += (audioState.targetMid - audioState.mid) * 0.18;
  audioState.treble += (audioState.targetTreble - audioState.treble) * 0.18;

  root.style.setProperty("--bass", audioState.bass.toFixed(3));
  root.style.setProperty("--mid", audioState.mid.toFixed(3));
  root.style.setProperty("--treble", audioState.treble.toFixed(3));

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
    applyUserProperty(properties, "showclock", (value) => {
      wallpaperConfig.showClock = parseBoolean(value, wallpaperConfig.showClock);
    });
    applyUserProperty(properties, "clockscale", (value) => {
      wallpaperConfig.clockScale = parseNumber(value, wallpaperConfig.clockScale);
    });
    applyUserProperty(properties, "clockxoffset", (value) => {
      wallpaperConfig.clockOffsetX = parseNumber(value, wallpaperConfig.clockOffsetX);
    });
    applyUserProperty(properties, "clockyoffset", (value) => {
      wallpaperConfig.clockOffsetY = parseNumber(value, wallpaperConfig.clockOffsetY);
    });
    applyUserProperty(properties, "clockopacity", (value) => {
      wallpaperConfig.clockOpacity = parseNumber(value, wallpaperConfig.clockOpacity);
    });
    applyUserProperty(properties, "accentcolor", (value) => {
      wallpaperConfig.accentColor = value;
    });
    applyUserProperty(properties, "customtitle", (value) => {
      wallpaperConfig.customTitle = `${value}`.trim() || TITLE_PLACEHOLDER;
    });
    applyUserProperty(properties, "customsubtitle", (value) => {
      wallpaperConfig.customSubtitle = `${value}`.trim() || SUBTITLE_PLACEHOLDER;
    });
    applyUserProperty(properties, "customkicker", (value) => {
      wallpaperConfig.customKicker = `${value}`.trim() || KICKER_PLACEHOLDER;
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
