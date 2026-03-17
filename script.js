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
  hasMoved: false,
};

const bgmEnvelope = Array.isArray(window.__bgmEnvelopeData?.values) ? window.__bgmEnvelopeData.values : [];
const bgmDuration = Number(window.__bgmEnvelopeData?.duration) || 0;
const bgmEnvelopeReady = bgmEnvelope.length > 0 && bgmDuration > 0;

const TITLE_PLACEHOLDER = "\u745e\u9e64\u4ed9";
const SUBTITLE_PLACEHOLDER = "\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a";
const KICKER_PLACEHOLDER = "RUI HE XIAN";
const TITLE_DEFAULTS = {
  title: TITLE_PLACEHOLDER,
  subtitle: SUBTITLE_PLACEHOLDER,
  kicker: KICKER_PLACEHOLDER,
};
const AUDIO_STYLE_VALUES = ["water", "bars", "dots"];
const BASE_RIPPLE_SIZE = 88;
const BASE_RIPPLE_INTENSITY = 1;
const AUDIO_AXIS_RATIO = 0.5;
const AUDIO_CENTER_Y_RATIO = 0.515;
const AUDIO_CENTER_OFFSET_RADIUS_MULTIPLIER = 2.6;
const CLOCK_Y_RATIO = 0.31;
const SPECTRUM_BAR_COUNT = 41;
const SPECTRUM_BAR_GAP = 6;
const SPECTRUM_BAR_WIDTH_MIN = 2.2;
const SPECTRUM_BAR_WIDTH_MULTIPLIER = 2.34;
const MAX_FEATHER_COUNT = 4;

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
  audioStyle: "water",
  audioScale: 100,
  audioOffsetY: 0,
  audioSensitivity: 120,
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


function isValidAudioStyle(value) {
  return AUDIO_STYLE_VALUES.includes(value);
}

function getAudioStyle(value, fallback = "water") {
  return isValidAudioStyle(value) ? value : fallback;
}

function getAudioHaloConfig(style) {
  switch (style) {
    case "bars":
      return { scale: 2.5, opacity: 0.055 };
    case "dots":
      return { scale: 2.05, opacity: 0.042 };
    default:
      return { scale: 2.6, opacity: 0.065 };
  }
}

function normalizeText(value, fallback) {
  return `${value || ""}`.trim() || fallback;
}

function toRgba(color, alpha) {
  return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

function setDisplay(element, isVisible, displayValue = "block") {
  if (!element) {
    return;
  }

  element.style.display = isVisible ? displayValue : "none";
}

function updateTitleBlock() {
  const titleText = normalizeText(wallpaperConfig.customTitle, TITLE_DEFAULTS.title);
  const subtitleText = normalizeText(wallpaperConfig.customSubtitle, TITLE_DEFAULTS.subtitle);
  const kickerText = normalizeText(wallpaperConfig.customKicker, TITLE_DEFAULTS.kicker);

  if (customTitleElement) {
    customTitleElement.textContent = titleText;
    customTitleElement.setAttribute("data-text", titleText);
  }

  if (customSubtitleElement) {
    customSubtitleElement.textContent = subtitleText;
    setDisplay(customSubtitleElement, Boolean(subtitleText));
  }

  if (customKickerElement) {
    customKickerElement.textContent = kickerText;
    setDisplay(customKickerElement, Boolean(kickerText));
  }

  setDisplay(titleBlockElement, Boolean(titleText || subtitleText || kickerText), "flex");
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
  root.style.setProperty("--clock-scale", `${clamp(parseNumber(wallpaperConfig.clockScale, 100), 60, 180) / 100}`);
  root.style.setProperty("--clock-offset-x", `${clamp(parseNumber(wallpaperConfig.clockOffsetX, 0), -600, 600)}px`);
  root.style.setProperty("--clock-offset-y", `${clamp(parseNumber(wallpaperConfig.clockOffsetY, 0), -400, 400)}px`);
  root.style.setProperty("--clock-opacity", `${clamp(parseNumber(wallpaperConfig.clockOpacity, 92), 10, 100) / 100}`);
  bgm.volume = clamp(parseNumber(wallpaperConfig.bgmVolume, 35) / 100, 0, 1);
  updateTitleBlock();
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
    pointerState.hasMoved = true;
  });

  window.addEventListener("mouseleave", () => {
    hud.style.setProperty("--mx", "0px");
    hud.style.setProperty("--my", "0px");
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
  gradient.addColorStop(0.24, toRgba(accent, alpha));
  gradient.addColorStop(0.78, toRgba(accent, alpha * 0.24));
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  canvasContext.beginPath();
  canvasContext.fillStyle = gradient;
  canvasContext.arc(x, y, radius, 0, Math.PI * 2);
  canvasContext.fill();
}

function drawWaterVisualizer(centerX, centerY, outerRadius, rippleAmplitude, rippleIntensity, bassPulse, midPulse, treblePulse, accent, spectrum, time) {
  const rippleBase = outerRadius * 0.72;
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
    drawRippleRing(centerX, centerY, ring.radius, ring.amplitude, ring.thickness, ring.alpha, accent, spectrum, ring.phase, ring.rotation);
  });

  for (let index = 0; index < 10; index += 1) {
    const angle = time * 0.28 + (Math.PI * 2 * index) / 10;
    const distance = rippleBase + 52 + bassPulse * 20 + Math.sin(time * 1.2 + index * 0.7) * 8;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance * 0.93;
    const size = 7 + treblePulse * 4 + (index % 3);
    drawGlowBlob(x, y, size * 1.6, 0.07 + treblePulse * 0.03, accent, 0.08);
  }
}


function drawBarsVisualizer(centerX, centerY, outerRadius, rippleAmplitude, rippleIntensity, bassPulse, midPulse, treblePulse, accent, spectrum, time) {
  const count = 48;
  const radius = outerRadius * 0.88;
  const yScale = 0.9;
  drawGlowBlob(centerX, centerY, outerRadius * 0.32, 0.022 + bassPulse * 0.008, accent, 0.018);

  for (let index = 0; index < count; index += 1) {
    const progress = index / count;
    const angle = progress * Math.PI * 2 - Math.PI / 2 + time * 0.03;
    const energy = spectrum[Math.floor(progress * (spectrum.length - 1))] || 0;
    const inner = radius + Math.sin(time * 0.6 + index * 0.2) * 1.5;
    const bar = 32 + energy * (74 + rippleAmplitude * 0.24) + bassPulse * 18;
    const thickness = 1.8 + rippleIntensity * 0.16 + (index % 5 === 0 ? 0.9 : 0);
    const x1 = centerX + Math.cos(angle) * inner;
    const y1 = centerY + Math.sin(angle) * inner * yScale;
    const x2 = centerX + Math.cos(angle) * (inner + bar);
    const y2 = centerY + Math.sin(angle) * (inner + bar) * yScale;

    canvasContext.beginPath();
    canvasContext.moveTo(x1, y1);
    canvasContext.lineTo(x2, y2);
    canvasContext.lineWidth = thickness;
    canvasContext.strokeStyle = toRgba(accent, 0.12 + energy * 0.18);
    canvasContext.shadowBlur = 10 + energy * 10;
    canvasContext.shadowColor = toRgba(accent, 0.08 + energy * 0.1);
    canvasContext.lineCap = "round";
    canvasContext.stroke();
  }

  drawOpenArc(centerX, centerY, radius - 12, (radius - 12) * yScale, Math.PI * 0.16, Math.PI * 0.84, 2, 0.08 + midPulse * 0.018, accent, time * 0.008);
  drawOpenArc(centerX, centerY, radius - 12, (radius - 12) * yScale, Math.PI * 1.16, Math.PI * 1.84, 2, 0.08 + treblePulse * 0.018, accent, -time * 0.008);
}

function drawSpectrumBarsVisualizer(centerX, centerY, stableOuterRadius, rippleAmplitude, bassPulse, midPulse, accent, spectrum) {
  const totalWidth = stableOuterRadius * SPECTRUM_BAR_WIDTH_MULTIPLIER;
  const barWidth = Math.max(SPECTRUM_BAR_WIDTH_MIN, (totalWidth - SPECTRUM_BAR_GAP * (SPECTRUM_BAR_COUNT - 1)) / SPECTRUM_BAR_COUNT);
  const startX = centerX - totalWidth / 2;
  const baselineY = centerY;
  const maxHeight = stableOuterRadius * 1.08;
  const centerIndex = Math.floor(SPECTRUM_BAR_COUNT / 2);
  const sideCount = centerIndex;

  drawGlowBlob(centerX, centerY, stableOuterRadius * 0.16, 0.01 + midPulse * 0.004, accent, 0.01);

  canvasContext.beginPath();
  canvasContext.moveTo(startX - 18, baselineY);
  canvasContext.lineTo(startX + totalWidth + 18, baselineY);
  canvasContext.lineWidth = 1;
  canvasContext.strokeStyle = toRgba(accent, 0.06);
  canvasContext.stroke();

  for (let index = 0; index < SPECTRUM_BAR_COUNT; index += 1) {
    if (index >= SPECTRUM_BAR_COUNT - 7) {
      continue;
    }

    const mirroredIndex = index <= centerIndex ? index : SPECTRUM_BAR_COUNT - 1 - index;
    const progress = mirroredIndex / Math.max(sideCount, 1);
    const energy = spectrum[Math.floor(progress * (spectrum.length - 1))] || 0;
    const x = startX + index * (barWidth + SPECTRUM_BAR_GAP);
    const distanceFromCenter = Math.abs(index - centerIndex) / Math.max(centerIndex, 1);
    const centerSuppression = 0.58 + distanceFromCenter * 0.42;
    const upperHeight = (10 + energy * (maxHeight + rippleAmplitude * 0.18) + bassPulse * 4) * centerSuppression;
    const lowerHeight = Math.max(2.5, upperHeight * (0.08 + midPulse * 0.02));
    const alpha = 0.16 + energy * 0.22;
    const fill = toRgba(accent, alpha);

    canvasContext.shadowBlur = 6 + energy * 8;
    canvasContext.shadowColor = toRgba(accent, 0.05 + energy * 0.05);
    canvasContext.fillStyle = fill;
    canvasContext.fillRect(x, baselineY - upperHeight, barWidth, upperHeight);
    canvasContext.fillRect(x, baselineY + 3, barWidth, lowerHeight);
  }
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
  canvasContext.strokeStyle = toRgba(accent, alpha);
  canvasContext.shadowBlur = 18 + amplitude * 0.28;
  canvasContext.shadowColor = toRgba(accent, alpha * 0.44);
  canvasContext.lineJoin = "round";
  canvasContext.lineCap = "round";
  canvasContext.stroke();
}


function drawOpenArc(centerX, centerY, radiusX, radiusY, startAngle, endAngle, thickness, alpha, accent, rotation = 0) {
  canvasContext.save();
  canvasContext.translate(centerX, centerY);
  canvasContext.rotate(rotation);
  canvasContext.beginPath();
  canvasContext.ellipse(0, 0, radiusX, radiusY, 0, startAngle, endAngle);
  canvasContext.lineWidth = thickness;
  canvasContext.strokeStyle = toRgba(accent, alpha);
  canvasContext.shadowBlur = 12;
  canvasContext.shadowColor = toRgba(accent, alpha * 0.35);
  canvasContext.lineCap = "round";
  canvasContext.stroke();
  canvasContext.restore();
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
  for (let index = 0; index < 1; index += 1) {
    if (featherParticles.length >= MAX_FEATHER_COUNT) {
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

  if (featherParticles.length > MAX_FEATHER_COUNT) {
    featherParticles.splice(0, featherParticles.length - MAX_FEATHER_COUNT);
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
    canvasContext.filter = "brightness(0.08) saturate(0.2)";
    canvasContext.drawImage(featherImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    canvasContext.filter = "none";
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
  const rippleIntensity = BASE_RIPPLE_INTENSITY;
  const axisX = width * AUDIO_AXIS_RATIO;
  const centerX = axisX;
  const time = performance.now() * 0.001;
  const bassPulse = Math.pow(audioState.bass, 1.02) * 1.9;
  const midPulse = Math.pow(audioState.mid, 0.98) * 1.6;
  const treblePulse = Math.pow(audioState.treble, 0.94) * 1.35;
  const audioScale = clamp(parseNumber(wallpaperConfig.audioScale, 100), 40, 240) / 100;
  const audioOffsetY = clamp(parseNumber(wallpaperConfig.audioOffsetY, 0), -400, 400);
  const anchorRadius = Math.min(width, height) * 0.076 + BASE_RIPPLE_SIZE * 0.2;
  const centerY = height * AUDIO_CENTER_Y_RATIO + anchorRadius * AUDIO_CENTER_OFFSET_RADIUS_MULTIPLIER + audioOffsetY;
  const sunRadius = Math.min(width, height) * 0.076 + BASE_RIPPLE_SIZE * 0.2;
  const stableOuterRadius = sunRadius * 1.46;
  const outerRadius = sunRadius * (1.46 + bassPulse * 0.18);
  const rippleAmplitude = 20 + BASE_RIPPLE_SIZE * 0.12 + bassPulse * 18 + treblePulse * 8;
  const audioStyle = getAudioStyle(wallpaperConfig.audioStyle);

  canvasContext.clearRect(0, 0, width, height);

  if (waterHalo) {
    const haloConfig = getAudioHaloConfig(audioStyle);
    waterHalo.style.left = `${centerX}px`;
    waterHalo.style.top = `${centerY}px`;
    waterHalo.style.width = `${outerRadius * haloConfig.scale * audioScale}px`;
    waterHalo.style.opacity = `${haloConfig.opacity + bassPulse * 0.01 + midPulse * 0.004}`;
  }

  const clockX = axisX;
  const clockY = height * CLOCK_Y_RATIO;
  root.style.setProperty("--axis-x", `${axisX}px`);
  root.style.setProperty("--clock-x", `${clockX}px`);
  root.style.setProperty("--clock-y", `${clockY}px`);

  canvasContext.save();
  canvasContext.translate(centerX, centerY);
  canvasContext.scale(audioScale, audioScale);
  canvasContext.translate(-centerX, -centerY);

  const halo = canvasContext.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius * 1.52);
  halo.addColorStop(0, "rgba(249, 242, 234, 0.02)");
  halo.addColorStop(0.08, toRgba(accent, 0.08));
  halo.addColorStop(0.28, toRgba(accent, 0.055));
  halo.addColorStop(0.62, toRgba(accent, 0.018));
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  canvasContext.beginPath();
  canvasContext.fillStyle = halo;
  canvasContext.arc(centerX, centerY, outerRadius * 1.52, 0, Math.PI * 2);
  canvasContext.fill();

  const spectrum = audioState.spectrum;
  if (audioStyle === "bars") {
    drawBarsVisualizer(centerX, centerY, outerRadius, rippleAmplitude, rippleIntensity, bassPulse, midPulse, treblePulse, accent, spectrum, time);
  } else if (audioStyle === "dots") {
    drawSpectrumBarsVisualizer(centerX, centerY, stableOuterRadius, rippleAmplitude, bassPulse, midPulse, accent, spectrum);
  } else {
    drawWaterVisualizer(centerX, centerY, outerRadius, rippleAmplitude, rippleIntensity, bassPulse, midPulse, treblePulse, accent, spectrum, time);
  }
  canvasContext.restore();

  canvasContext.shadowBlur = 0;
  canvasContext.globalCompositeOperation = "source-over";
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
    applyUserProperty(properties, "audiostyle", (value) => {
      wallpaperConfig.audioStyle = getAudioStyle(value, wallpaperConfig.audioStyle);
    });
    applyUserProperty(properties, "audioscale", (value) => {
      wallpaperConfig.audioScale = parseNumber(value, wallpaperConfig.audioScale);
    });
    applyUserProperty(properties, "audiooffsety", (value) => {
      wallpaperConfig.audioOffsetY = parseNumber(value, wallpaperConfig.audioOffsetY);
    });
    applyUserProperty(properties, "customtitle", (value) => {
      wallpaperConfig.customTitle = normalizeText(value, TITLE_DEFAULTS.title);
    });
    applyUserProperty(properties, "customsubtitle", (value) => {
      wallpaperConfig.customSubtitle = normalizeText(value, TITLE_DEFAULTS.subtitle);
    });
    applyUserProperty(properties, "customkicker", (value) => {
      wallpaperConfig.customKicker = normalizeText(value, TITLE_DEFAULTS.kicker);
    });
    applyUserProperty(properties, "audiosensitivity", (value) => {
      wallpaperConfig.audioSensitivity = parseNumber(value, wallpaperConfig.audioSensitivity);
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
