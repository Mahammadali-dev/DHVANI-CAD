/**
 * @fileoverview Main UI controller for DHVANI-CAD binding the 6 SIP/RTP trunk visualizers,
 * live Web Audio API oscilloscope/FFT spectrogram, hardware Geolocation, and Gemini 2.5 Flash triage.
 * Uses strict DOM node creation (zero innerHTML) to guarantee XSS immunity.
 */

import { TELECOM_NODES, FORENSIC_PRESETS, recordDiagnosticEvent } from "../config/telecomNodes.js";
import { LiveAudioInterceptor } from "../dsp/acousticAnalyzer.js";
import { INCIDENT_CODES } from "../core/triageEngine.js";
import {
  analyzeEmergencyStream,
  getStoredGeminiKey,
  setStoredGeminiKey
} from "../services/geminiService.js";
import { RealWorldTelemetryRelay } from "../services/realtimeRelay.js";

const channelCanvases = new Map();
const interceptor = new LiveAudioInterceptor();
let relay = null;

let currentTelemetry = {
  f0Hz: 140.0,
  jitterPercent: 0.55,
  dbSpl: 60.2,
  zcr: 0.068
};
let lastAuditPacket = null;
let phaseTick = 0;

/**
 * Bootstraps the DHVANI-CAD console once the DOM is ready.
 */
function initDashboard() {
  renderChannelList();
  initRealWorldRelayAndGps();
  bindControls();
  startClock();
  start60FpsRenderLoop();
  updateEngineStatusBadge();
}

/**
 * Initializes the cross-device SSE telemetry stream and hardware GPS watcher.
 */
function initRealWorldRelayAndGps() {
  const roomInput = document.getElementById("relayRoomInput");
  const initialRoom = roomInput ? roomInput.value : "dhvani-vvitu-112";

  relay = new RealWorldTelemetryRelay(initialRoom, (remotePacket) => {
    renderIncomingTelemetryPacket(remotePacket, true);
  });

  relay.connectLiveStream(initialRoom);

  if (roomInput) {
    roomInput.addEventListener("change", () => {
      relay.connectLiveStream(roomInput.value);
    });
  }

  relay.startLiveGpsTracking((gps) => {
    const gpsFixBadge = document.getElementById("gpsFixBadge");
    const gpsAccMeta = document.getElementById("gpsAccuracyMeta");
    const liveAddrHeader = document.getElementById("liveAddressHeader");
    const ticketCoords = document.getElementById("ticketCoords");
    const ticketCellId = document.getElementById("ticketCellId");
    const mapsLink = document.getElementById("liveGoogleMapsLink");

    if (gpsFixBadge) {
      gpsFixBadge.textContent = gps.isHardwareFix
        ? `${gps.lat.toFixed(4)}N, ${gps.lng.toFixed(4)}E`
        : "CELL-SECTOR";
    }
    if (gpsAccMeta) {
      gpsAccMeta.textContent = `GPS ACC: +/- ${gps.accuracyMeters}m`;
    }
    if (liveAddrHeader) {
      liveAddrHeader.textContent = `LIVE LOCATION: ${gps.resolvedAddress.toUpperCase()}`;
    }
    if (ticketCoords) {
      ticketCoords.textContent = `${gps.lat.toFixed(5)} N, ${gps.lng.toFixed(5)} E`;
    }
    if (ticketCellId) {
      ticketCellId.textContent = gps.resolvedAddress;
    }
    if (mapsLink) {
      mapsLink.href = `https://www.google.com/maps?q=${encodeURIComponent(gps.lat)},${encodeURIComponent(gps.lng)}`;
    }
  });
}

/**
 * Constructs a single telecom channel card using safe DOM APIs (no innerHTML).
 * @param {Object} node Telecom node configuration
 * @returns {{ card: HTMLElement, canvas: HTMLCanvasElement }}
 */
function createChannelCardElement(node) {
  const card = document.createElement("div");
  card.className = `channel-card ${node.isLiveHardwareChannel ? "active-intercept" : ""}`;
  card.id = `card-${node.channelId}`;
  card.setAttribute("role", "listitem");

  const topRow = document.createElement("div");
  topRow.className = "channel-top";

  const idCluster = document.createElement("div");
  idCluster.className = "channel-id";

  const led = document.createElement("span");
  led.className = "led led-nominal";
  led.id = `led-${node.channelId}`;
  led.setAttribute("aria-hidden", "true");

  const titleSpan = document.createElement("span");
  titleSpan.textContent = `${node.channelId} // ${node.cellId}`;

  idCluster.append(led, titleSpan);

  const rssiSpan = document.createElement("span");
  rssiSpan.className = "rssi-tag";
  rssiSpan.textContent = `${node.rssiDbm} dBm`;

  topRow.append(idCluster, rssiSpan);

  const sectorDiv = document.createElement("div");
  sectorDiv.className = "channel-sector";
  sectorDiv.textContent = node.sectorName;

  const canvas = document.createElement("canvas");
  canvas.className = "channel-wave-canvas";
  canvas.id = `wave-${node.channelId}`;
  canvas.width = 310;
  canvas.height = 32;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Waveform monitor for ${node.channelId}`);

  const metricsRow = document.createElement("div");
  metricsRow.className = "channel-metrics";

  const trunkSpan = document.createElement("span");
  trunkSpan.textContent = `TRUNK: ${node.sipTrunk}`;

  const submetricSpan = document.createElement("span");
  submetricSpan.id = `submetric-${node.channelId}`;
  submetricSpan.textContent = `F0: ${node.baselineF0}Hz | JIT: ${node.baselineJitter}%`;

  metricsRow.append(trunkSpan, submetricSpan);
  card.append(topRow, sectorDiv, canvas, metricsRow);

  return { card, canvas };
}

/**
 * Renders all 6 cellular trunk monitors into the left column.
 */
function renderChannelList() {
  const container = document.getElementById("channelListContainer");
  if (!container) return;

  const fragment = document.createDocumentFragment();
  for (const node of TELECOM_NODES) {
    const { card, canvas } = createChannelCardElement(node);
    fragment.appendChild(card);
    channelCanvases.set(node.channelId, {
      canvas,
      ctx: canvas.getContext("2d"),
      node
    });
  }
  container.replaceChildren(fragment);
}

/**
 * Binds UI buttons, presets, and modal dialogs.
 */
function bindControls() {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const presetKey = btn.getAttribute("data-preset");
      const preset = FORENSIC_PRESETS[presetKey];
      if (preset) {
        await processAndBroadcastScenario(preset);
      }
    });
  });

  const liveMicBtn = document.getElementById("toggleLiveMicBtn");
  if (liveMicBtn) {
    liveMicBtn.addEventListener("click", toggleContinuousGuardian);
  }

  const modal = document.getElementById("apiKeyModal");
  const keyInput = document.getElementById("geminiApiKeyInput");
  const openBtn = document.getElementById("openApiKeyModalBtn");
  const closeBtn = document.getElementById("closeApiKeyModalBtn");
  const saveBtn = document.getElementById("saveApiKeyBtn");

  if (openBtn && modal && keyInput) {
    openBtn.addEventListener("click", () => {
      keyInput.value = getStoredGeminiKey();
      modal.hidden = false;
      keyInput.focus();
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.hidden = true;
    });
  }

  if (saveBtn && modal && keyInput) {
    saveBtn.addEventListener("click", () => {
      setStoredGeminiKey(keyInput.value);
      modal.hidden = true;
      updateEngineStatusBadge();
    });
  }

  const exportBtn = document.getElementById("exportAuditJsonBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportIncidentJson);
  }
}

/**
 * Updates the engine status indicator based on whether a Gemini API key is configured.
 */
function updateEngineStatusBadge() {
  const hasKey = Boolean(getStoredGeminiKey());
  const el = document.getElementById("engineModeReadout");
  if (el) {
    el.textContent = hasKey ? "GEMINI-2.5 + LIVE VAD" : "CONTINUOUS DSP + VAD";
  }
}

/**
 * Toggles the continuous zero-touch microphone guardian on Channel 06.
 */
async function toggleContinuousGuardian() {
  const btn = document.getElementById("toggleLiveMicBtn");
  const label = document.getElementById("liveMicBtnLabel");
  if (!btn || !label) return;

  if (interceptor.isActive) {
    interceptor.stop();
    btn.classList.remove("recording");
    btn.setAttribute("aria-pressed", "false");
    label.textContent = "[ARM ZERO-TOUCH CONTINUOUS GUARDIAN]";
    return;
  }

  try {
    await interceptor.startContinuousGuardian(async (autonomousPayload) => {
      await processAndBroadcastScenario(autonomousPayload);
    });
    btn.classList.add("recording");
    btn.setAttribute("aria-pressed", "true");
    label.textContent = "[GUARDIAN ARMED — HANDS-FREE LISTENING ACTIVE]";
    const readout = document.getElementById("transcriptReadout");
    if (readout) {
      readout.textContent =
        "[GUARDIAN ARMED: SPEAK IN TELUGU/ENGLISH OR WHISPER HANDS-FREE — NO BUTTON PRESS NEEDED]";
    }
  } catch (micError) {
    recordDiagnosticEvent("MIC_GUARDIAN", micError);
    btn.classList.remove("recording");
    btn.setAttribute("aria-pressed", "false");
    label.textContent = "[MIC PERMISSION REQUIRED FOR LIVE GUARDIAN]";
  }
}

/**
 * Runs acoustic + semantic triage and broadcasts the resulting packet across connected devices.
 * @param {Object} payload Input telemetry frame
 */
async function processAndBroadcastScenario(payload) {
  const { result, engineSource, latencyMs } = await analyzeEmergencyStream(payload);
  const fullPacket = {
    ...result,
    f0Hz: payload.f0Hz,
    jitterPercent: payload.jitterPercent,
    dbSpl: payload.dbSpl,
    zcr: payload.zcr,
    engineSource,
    latencyMs
  };

  const broadcasted = await relay.broadcastEmergencyPacket(fullPacket);
  relay.triggerPhysicalVoiceActuator(broadcasted);
  renderIncomingTelemetryPacket(broadcasted, false);
}

/**
 * Renders an evaluated emergency telemetry packet into all dashboard gauges and cards.
 * @param {Object} packet Triage packet
 * @param {boolean} [isRemoteRelay=false] True if received over SSE from a remote field device
 */
function renderIncomingTelemetryPacket(packet, isRemoteRelay = false) {
  currentTelemetry = {
    f0Hz: Number(packet.f0Hz || 140),
    jitterPercent: Number(packet.jitterPercent || 0.55),
    dbSpl: Number(packet.dbSpl || 60),
    zcr: Number(packet.zcr || 0.068)
  };

  lastAuditPacket = packet;

  document.getElementById("metricF0").textContent = `${currentTelemetry.f0Hz.toFixed(1)} Hz`;
  document.getElementById("metricJitter").textContent = `${currentTelemetry.jitterPercent.toFixed(2)} %`;
  document.getElementById("metricSpl").textContent = `${currentTelemetry.dbSpl.toFixed(1)} dB`;
  document.getElementById("metricZcr").textContent = currentTelemetry.zcr.toFixed(3);
  document.getElementById("f0PeakCursorLabel").textContent = `F0 PEAK: ${currentTelemetry.f0Hz.toFixed(1)} Hz`;

  document.getElementById("inferenceLatencyReadout").textContent =
    `LATENCY: ${packet.latencyMs || 6} ms ${isRemoteRelay ? "(REMOTE FIELD NODE)" : "(LOCAL NODE)"}`;
  document.getElementById("detectedLangBadge").textContent = `LANG: ${packet.detectedLanguage}`;
  document.getElementById("transcriptReadout").textContent = packet.verbatimTranscript;

  if (packet.gps) {
    document.getElementById("ticketCoords").textContent =
      `${Number(packet.gps.lat).toFixed(5)} N, ${Number(packet.gps.lng).toFixed(5)} E`;
    document.getElementById("ticketCellId").textContent = packet.gps.resolvedAddress;
    document.getElementById("liveGoogleMapsLink").href =
      `https://www.google.com/maps?q=${encodeURIComponent(packet.gps.lat)},${encodeURIComponent(packet.gps.lng)}`;
  }

  const links = relay.buildEmergencyDispatchLinks(packet);
  document.getElementById("liveSms112Link").href = links.smsHref;

  updateGateMeters(packet);
  updateMarkerTags(packet.paralinguisticMarkers, packet.acousticEnvironment);
  updateDispatchTicket(packet, packet.engineSource || "LIVE_RELAY");
}

/**
 * Updates the 3 Dual-Threshold progress bars and their ARIA attributes.
 * @param {Object} result
 */
function updateGateMeters(result) {
  const kwFill = document.getElementById("keywordMeterFill");
  const vsFill = document.getElementById("vocalStressMeterFill");
  const compFill = document.getElementById("compositeMeterFill");

  const kwTrack = document.getElementById("keywordProgressTrack");
  const vsTrack = document.getElementById("vocalStressProgressTrack");
  const compTrack = document.getElementById("compositeProgressTrack");

  document.getElementById("keywordScoreVal").textContent = `${result.keywordIndex}%`;
  document.getElementById("vocalStressScoreVal").textContent = `${result.vocalStressIndex}%`;
  document.getElementById("compositeScoreVal").textContent = `${result.compositeThreatScore}%`;

  if (kwTrack) kwTrack.setAttribute("aria-valuenow", String(result.keywordIndex));
  if (vsTrack) vsTrack.setAttribute("aria-valuenow", String(result.vocalStressIndex));
  if (compTrack) compTrack.setAttribute("aria-valuenow", String(result.compositeThreatScore));

  kwFill.style.width = `${result.keywordIndex}%`;
  kwFill.style.backgroundColor = result.keywordIndex >= 60 ? "#f59e0b" : "#10b981";

  vsFill.style.width = `${result.vocalStressIndex}%`;
  vsFill.style.backgroundColor = result.vocalStressIndex >= 70 ? "#ef4444" : "#10b981";

  compFill.style.width = `${result.compositeThreatScore}%`;
  compFill.style.backgroundColor =
    result.compositeThreatScore >= 78
      ? "#ef4444"
      : result.incidentCode === INCIDENT_CODES.FALSE_POSITIVE
      ? "#10b981"
      : "#38bdf8";
}

/**
 * Safely populates the paralinguistic marker badges using replaceChildren.
 * @param {string[]} [markers=[]]
 * @param {string[]} [envTags=[]]
 */
function updateMarkerTags(markers = [], envTags = []) {
  const container = document.getElementById("markerTagsContainer");
  if (!container) return;

  const fragment = document.createDocumentFragment();
  [...markers, ...envTags].forEach((tag) => {
    const span = document.createElement("span");
    span.className = "marker-tag";
    span.textContent = String(tag);
    fragment.appendChild(span);
  });
  container.replaceChildren(fragment);
}

/**
 * Updates the right-hand PSAP dispatch ticket and triangulation reticle.
 * @param {Object} result
 * @param {string} engineSource
 */
function updateDispatchTicket(result, engineSource) {
  const card = document.getElementById("dispatchTicketCard");
  const banner = document.getElementById("incidentCodeBanner");
  const ch6Card = document.getElementById("card-CH-06");
  const ch6Led = document.getElementById("led-CH-06");
  const targetLockGroup = document.getElementById("targetLockGroup");

  card.classList.remove("status-critical", "status-covert");
  if (ch6Card) ch6Card.classList.remove("alert-critical");
  if (ch6Led) ch6Led.className = "led led-nominal";

  banner.textContent = result.incidentCode;
  document.getElementById("ticketUnit").textContent = result.dispatchDirective.unitCallsign;
  document.getElementById("ticketSirenPolicy").textContent = result.dispatchDirective.sirenPolicy;
  document.getElementById("ticketEngineSource").textContent = engineSource;
  document.getElementById("ticketTacticalBrief").textContent = result.dispatchDirective.tacticalBrief;

  if (result.incidentCode === INCIDENT_CODES.SILENT_INTERVENTION) {
    card.classList.add("status-covert");
    if (ch6Led) ch6Led.className = "led led-amber";
    if (targetLockGroup) targetLockGroup.setAttribute("opacity", "1");
  } else if (
    result.incidentCode === INCIDENT_CODES.CRITICAL_DISPATCH ||
    result.incidentCode === INCIDENT_CODES.MEDICAL_MVA
  ) {
    card.classList.add("status-critical");
    if (ch6Card) ch6Card.classList.add("alert-critical");
    if (ch6Led) ch6Led.className = "led led-critical";
    if (targetLockGroup) targetLockGroup.setAttribute("opacity", "1");
  } else if (targetLockGroup) {
    targetLockGroup.setAttribute("opacity", "0.25");
  }
}

/**
 * Starts the 60fps Canvas render loop for the time-domain oscilloscope and FFT spectrogram.
 */
function start60FpsRenderLoop() {
  const timeCanvas = document.getElementById("timeDomainCanvas");
  const timeCtx = timeCanvas.getContext("2d");
  const freqCanvas = document.getElementById("frequencyCanvas");
  const freqCtx = freqCanvas.getContext("2d");

  function renderFrame() {
    phaseTick += 0.08;

    const liveSample = interceptor.isActive
      ? interceptor.sampleTelemetry(async (nonVerbalSpike) => {
          await processAndBroadcastScenario(nonVerbalSpike);
        })
      : null;

    if (liveSample) {
      currentTelemetry = liveSample;
      document.getElementById("metricF0").textContent = `${liveSample.f0Hz.toFixed(1)} Hz`;
      document.getElementById("metricJitter").textContent = `${liveSample.jitterPercent.toFixed(2)} %`;
      document.getElementById("metricSpl").textContent = `${liveSample.dbSpl.toFixed(1)} dB`;
      document.getElementById("metricZcr").textContent = liveSample.zcr.toFixed(3);
      const subCh6 = document.getElementById("submetric-CH-06");
      if (subCh6) {
        subCh6.textContent = `F0: ${liveSample.f0Hz.toFixed(0)}Hz | JIT: ${liveSample.jitterPercent.toFixed(2)}%`;
      }
    }

    drawMiniChannelWaveforms();
    drawPrimaryOscilloscope(timeCtx, timeCanvas.width, timeCanvas.height, liveSample);
    drawPrimarySpectrogram(freqCtx, freqCanvas.width, freqCanvas.height, liveSample);

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);
}

/**
 * Draws the 6 compact SIP channel waveform strips.
 */
function drawMiniChannelWaveforms() {
  channelCanvases.forEach(({ canvas, ctx, node }) => {
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, width, height);

    const isCh6 = node.isLiveHardwareChannel;
    const isCritical = isCh6 && currentTelemetry.jitterPercent >= 2.2;
    ctx.strokeStyle = isCritical ? "#ef4444" : isCh6 ? "#38bdf8" : "#10b981";
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    const freqFactor = isCh6 ? currentTelemetry.f0Hz / 110 : node.baselineF0 / 120;
    const amp = isCh6 ? Math.min(13, (currentTelemetry.dbSpl - 30) / 5.5) : 6;

    for (let x = 0; x < width; x += 2) {
      const jitterNoise =
        isCh6 && currentTelemetry.jitterPercent > 1.8
          ? Math.sin(x * 0.9 + phaseTick * 4) * (currentTelemetry.jitterPercent * 1.1)
          : 0;
      const y = height / 2 + Math.sin(x * 0.06 * freqFactor + phaseTick) * amp + jitterNoise;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

/**
 * Renders the primary time-domain PCM oscilloscope trace.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {Object|null} liveSample
 */
function drawPrimaryOscilloscope(ctx, width, height, liveSample) {
  ctx.fillStyle = "#04070d";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#111c2d";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const isStressed = currentTelemetry.jitterPercent >= 2.0;
  ctx.strokeStyle = isStressed ? "#ef4444" : "#10b981";
  ctx.lineWidth = 1.6;
  ctx.beginPath();

  if (liveSample && liveSample.timeDomainData) {
    const buf = liveSample.timeDomainData;
    const slice = width / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const x = i * slice;
      const y = (0.5 + buf[i] * 0.45) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    const f0Ratio = currentTelemetry.f0Hz / 95;
    const amp = Math.min(44, Math.max(8, (currentTelemetry.dbSpl - 30) * 0.62));
    const jitterMod = currentTelemetry.jitterPercent * 2.2;

    for (let x = 0; x < width; x++) {
      const harmonic =
        Math.sin(x * 0.045 * f0Ratio + phaseTick * 1.8) * amp +
        Math.sin(x * 0.19 + phaseTick * 5.2) * jitterMod;
      const y = height / 2 + harmonic;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

/**
 * Renders the Fast Fourier Transform (FFT) spectral density bar graph.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {Object|null} liveSample
 */
function drawPrimarySpectrogram(ctx, width, height, liveSample) {
  ctx.fillStyle = "#04070d";
  ctx.fillRect(0, 0, width, height);

  const barCount = 48;
  const barWidth = width / barCount - 2;
  const peakBin = Math.min(
    barCount - 4,
    Math.max(3, Math.round((currentTelemetry.f0Hz / 500) * 26))
  );

  for (let i = 0; i < barCount; i++) {
    let magnitude = 0;
    if (liveSample && liveSample.frequencyData) {
      magnitude = liveSample.frequencyData[i * 2] / 255;
    } else {
      const dist = Math.abs(i - peakBin);
      magnitude = Math.max(
        0.08,
        Math.exp(-(dist * dist) / (currentTelemetry.jitterPercent > 2 ? 18 : 8)) *
          (currentTelemetry.dbSpl / 100)
      );
    }

    const barHeight = Math.min(height - 8, magnitude * (height - 10));
    ctx.fillStyle =
      i === peakBin
        ? "#ef4444"
        : currentTelemetry.jitterPercent >= 2.0
        ? "#f59e0b"
        : "#38bdf8";
    ctx.fillRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight);
  }
}

/**
 * Starts the Indian Standard Time (IST) synchronized header clock.
 */
function startClock() {
  const clockEl = document.getElementById("istClockReadout");
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: false
    });
  };
  update();
  setInterval(update, 1000);
}

/**
 * Exports the latest structured ERSS-112 incident audit packet as a downloadable JSON file.
 */
function exportIncidentJson() {
  const payload = lastAuditPacket || {
    system: "DHVANI-CAD",
    status: "ERSS_NOMINAL_STANDBY",
    psapNode: "AP-GNT-NAMBURU-04",
    timestamp: new Date().toISOString(),
    telemetry: currentTelemetry
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `DHVANI_ERSS112_INCIDENT_${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initDashboard);
}
