/**
 * @fileoverview Precision HiDPI UI controller for DHVANI-CAD.
 * Implements Retina devicePixelRatio canvas scaling, hardware Web Audio DSP binding,
 * live OpenStreetMap GPS reverse geocoding, and cross-device HTTPS SSE telemetry sync.
 */

import { TELECOM_NODES, FORENSIC_PRESETS } from "../config/telecomNodes.js";
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
 * Scales an HTML5 Canvas by window.devicePixelRatio for razor-sharp 4K/Retina rendering.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, width: number, height: number }}
 */
function configureHiDpiCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const logicalWidth = rect.width > 0 ? Math.round(rect.width) : Number(canvas.getAttribute("width")) || 320;
  const logicalHeight = rect.height > 0 ? Math.round(rect.height) : Number(canvas.getAttribute("height")) || 100;

  if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: logicalWidth, height: logicalHeight };
}

function initDashboard() {
  renderChannelRack();
  initRealWorldRelayAndGps();
  bindHardwareControls();
  startClock();
  start60FpsRenderLoop();
  updateEngineStatusBadge();
}

function initRealWorldRelayAndGps() {
  const roomInput = document.getElementById("relayRoomInput");
  const initialRoom = roomInput?.value || "dhvani-vvitu-112";

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
    const gpsAccuracyMeta = document.getElementById("gpsAccuracyMeta");
    const liveAddressHeader = document.getElementById("liveAddressHeader");
    const ticketCoords = document.getElementById("ticketCoords");
    const ticketCellId = document.getElementById("ticketCellId");
    const liveGoogleMapsLink = document.getElementById("liveGoogleMapsLink");

    if (gpsFixBadge) {
      gpsFixBadge.textContent = gps.isHardwareFix
        ? `${gps.lat.toFixed(4)}N, ${gps.lng.toFixed(4)}E`
        : "16.3462N, 80.5249E";
    }
    if (gpsAccuracyMeta) {
      gpsAccuracyMeta.textContent = `GPS: +/- ${gps.accuracyMeters}m`;
    }
    if (liveAddressHeader) {
      liveAddressHeader.textContent = `LIVE SECTOR: ${gps.resolvedAddress.toUpperCase()}`;
    }
    if (ticketCoords) {
      ticketCoords.textContent = `${gps.lat.toFixed(5)} N, ${gps.lng.toFixed(5)} E`;
    }
    if (ticketCellId) {
      ticketCellId.textContent = gps.resolvedAddress;
    }
    if (liveGoogleMapsLink) {
      liveGoogleMapsLink.href = `https://www.google.com/maps?q=${gps.lat},${gps.lng}`;
    }
  });
}

function renderChannelRack() {
  const container = document.getElementById("channelListContainer");
  if (!container) return;
  container.innerHTML = "";

  for (const node of TELECOM_NODES) {
    const slot = document.createElement("div");
    slot.className = `trunk-slot ${node.isLiveHardwareChannel ? "slot-primary" : ""}`;
    slot.id = `card-${node.channelId}`;
    slot.setAttribute("role", "listitem");
    slot.innerHTML = `
      <div class="trunk-row-top">
        <div class="trunk-ident">
          <span class="lamp lamp-nominal" id="led-${node.channelId}"></span>
          <span>${node.channelId} // ${node.cellId}</span>
        </div>
        <span class="tabular" style="font-size:10px;color:#9ca3af;">${node.rssiDbm} dBm</span>
      </div>
      <div class="trunk-sector-name">${node.sectorName}</div>
      <canvas class="mini-scope-canvas" id="wave-${node.channelId}" width="318" height="30"></canvas>
      <div class="trunk-telemetry-row">
        <span>${node.sipTrunk}</span>
        <span id="submetric-${node.channelId}" class="tabular">F0: ${node.baselineF0}Hz | JIT: ${node.baselineJitter}%</span>
      </div>
    `;
    container.appendChild(slot);
    const canvas = slot.querySelector("canvas");
    channelCanvases.set(node.channelId, { canvas, node });
  }
}

function bindHardwareControls() {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const presetKey = btn.getAttribute("data-preset");
      const preset = FORENSIC_PRESETS[presetKey];
      if (preset) {
        await processAndBroadcastScenario(preset);
      }
    });
  });

  const toggleMicBtn = document.getElementById("toggleLiveMicBtn");
  if (toggleMicBtn) {
    toggleMicBtn.addEventListener("click", toggleContinuousGuardian);
  }

  const modal = document.getElementById("apiKeyModal");
  const keyInput = document.getElementById("geminiApiKeyInput");
  const openKeyBtn = document.getElementById("openApiKeyModalBtn");
  const closeKeyBtn = document.getElementById("closeApiKeyModalBtn");
  const saveKeyBtn = document.getElementById("saveApiKeyBtn");

  if (openKeyBtn && modal && keyInput) {
    openKeyBtn.addEventListener("click", () => {
      keyInput.value = getStoredGeminiKey();
      modal.hidden = false;
      keyInput.focus();
    });
  }

  if (closeKeyBtn && modal) {
    closeKeyBtn.addEventListener("click", () => {
      modal.hidden = true;
    });
  }

  if (saveKeyBtn && modal && keyInput) {
    saveKeyBtn.addEventListener("click", () => {
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

function updateEngineStatusBadge() {
  const hasKey = Boolean(getStoredGeminiKey());
  const el = document.getElementById("engineModeReadout");
  if (el) {
    el.textContent = hasKey ? "GEMINI-2.5 + DSP ACTIVE" : "LOCAL AUTOCORRELATION DSP";
  }
}

async function toggleContinuousGuardian() {
  const btn = document.getElementById("toggleLiveMicBtn");
  const label = document.getElementById("liveMicBtnLabel");

  if (interceptor.isActive) {
    interceptor.stop();
    btn?.classList.remove("armed");
    if (label) label.textContent = "ARM ZERO-TOUCH CONTINUOUS GUARDIAN";
    return;
  }

  try {
    await interceptor.startContinuousGuardian(async (autonomousPayload) => {
      await processAndBroadcastScenario(autonomousPayload);
    });
    btn?.classList.add("armed");
    if (label) label.textContent = "GUARDIAN ARMED — HANDS-FREE VAD ACTIVE";
    const transcriptEl = document.getElementById("transcriptReadout");
    if (transcriptEl) {
      transcriptEl.textContent =
        "[ZERO-TOUCH GUARDIAN ARMED: SPEAK IN TELUGU/ENGLISH OR WHISPER HANDS-FREE]";
    }
  } catch (_) {
    btn?.classList.remove("armed");
    if (label) label.textContent = "MIC PERMISSION REQUIRED FOR LIVE GUARDIAN";
  }
}

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

function renderIncomingTelemetryPacket(packet, isRemoteRelay = false) {
  currentTelemetry = {
    f0Hz: Number(packet.f0Hz || 140),
    jitterPercent: Number(packet.jitterPercent || 0.55),
    dbSpl: Number(packet.dbSpl || 60),
    zcr: Number(packet.zcr || 0.068)
  };
  lastAuditPacket = packet;

  const f0El = document.getElementById("metricF0");
  const jitEl = document.getElementById("metricJitter");
  const splEl = document.getElementById("metricSpl");
  const zcrEl = document.getElementById("metricZcr");
  const cursorEl = document.getElementById("f0PeakCursorLabel");
  const latencyEl = document.getElementById("inferenceLatencyReadout");
  const langBadge = document.getElementById("detectedLangBadge");
  const transcriptEl = document.getElementById("transcriptReadout");

  if (f0El) f0El.textContent = `${currentTelemetry.f0Hz.toFixed(1)} Hz`;
  if (jitEl) jitEl.textContent = `${currentTelemetry.jitterPercent.toFixed(2)} %`;
  if (splEl) splEl.textContent = `${currentTelemetry.dbSpl.toFixed(1)} dB`;
  if (zcrEl) zcrEl.textContent = currentTelemetry.zcr.toFixed(3);
  if (cursorEl) cursorEl.textContent = `F0 PEAK: ${currentTelemetry.f0Hz.toFixed(1)} Hz`;
  if (latencyEl) {
    latencyEl.textContent = `LATENCY: ${packet.latencyMs || 5} ms ${isRemoteRelay ? "(REMOTE RELAY)" : "(LOCAL DSP)"}`;
  }
  if (langBadge) langBadge.textContent = `LANG: ${packet.detectedLanguage}`;
  if (transcriptEl) transcriptEl.textContent = packet.verbatimTranscript;

  if (packet.gps) {
    const coordsEl = document.getElementById("ticketCoords");
    const cellEl = document.getElementById("ticketCellId");
    const mapsLink = document.getElementById("liveGoogleMapsLink");
    if (coordsEl) coordsEl.textContent = `${packet.gps.lat.toFixed(5)} N, ${packet.gps.lng.toFixed(5)} E`;
    if (cellEl) cellEl.textContent = packet.gps.resolvedAddress;
    if (mapsLink) mapsLink.href = `https://www.google.com/maps?q=${packet.gps.lat},${packet.gps.lng}`;
  }

  const links = relay.buildEmergencyDispatchLinks(packet);
  const smsLink = document.getElementById("liveSms112Link");
  if (smsLink) smsLink.href = links.smsHref;

  updateGateMeters(packet);
  updateMarkerTags(packet.paralinguisticMarkers, packet.acousticEnvironment);
  updateDispatchTicket(packet, packet.engineSource || "LIVE_RELAY");
}

function updateGateMeters(result) {
  const kwFill = document.getElementById("keywordMeterFill");
  const vsFill = document.getElementById("vocalStressMeterFill");
  const compFill = document.getElementById("compositeMeterFill");
  const kwVal = document.getElementById("keywordScoreVal");
  const vsVal = document.getElementById("vocalStressScoreVal");
  const compVal = document.getElementById("compositeScoreVal");

  if (kwVal) kwVal.textContent = `${result.keywordIndex}%`;
  if (vsVal) vsVal.textContent = `${result.vocalStressIndex}%`;
  if (compVal) compVal.textContent = `${result.compositeThreatScore}%`;

  if (kwFill) {
    kwFill.style.width = `${result.keywordIndex}%`;
    kwFill.style.backgroundColor = result.keywordIndex >= 60 ? "#ffb020" : "#00e599";
  }
  if (vsFill) {
    vsFill.style.width = `${result.vocalStressIndex}%`;
    vsFill.style.backgroundColor = result.vocalStressIndex >= 70 ? "#ff2e4c" : "#00e599";
  }
  if (compFill) {
    compFill.style.width = `${result.compositeThreatScore}%`;
    compFill.style.backgroundColor =
      result.compositeThreatScore >= 78
        ? "#ff2e4c"
        : result.incidentCode === INCIDENT_CODES.FALSE_POSITIVE
        ? "#00e599"
        : "#00b8ff";
  }
}

function updateMarkerTags(markers = [], envTags = []) {
  const container = document.getElementById("markerTagsContainer");
  if (!container) return;
  container.innerHTML = "";
  [...markers, ...envTags].forEach((tag) => {
    const span = document.createElement("span");
    span.className = "forensic-chip";
    span.textContent = tag;
    container.appendChild(span);
  });
}

function updateDispatchTicket(result, engineSource) {
  const card = document.getElementById("dispatchTicketCard");
  const banner = document.getElementById("incidentCodeBanner");
  const ch6Card = document.getElementById("card-CH-06");
  const ch6Led = document.getElementById("led-CH-06");
  const targetLockGroup = document.getElementById("targetLockGroup");
  const ticketUnit = document.getElementById("ticketUnit");
  const ticketSirenPolicy = document.getElementById("ticketSirenPolicy");
  const ticketEngineSource = document.getElementById("ticketEngineSource");
  const ticketTacticalBrief = document.getElementById("ticketTacticalBrief");

  card?.classList.remove("state-critical", "state-covert");
  ch6Card?.classList.remove("slot-critical");
  if (ch6Led) ch6Led.className = "lamp lamp-nominal";

  if (banner) banner.textContent = result.incidentCode;
  if (ticketUnit) ticketUnit.textContent = result.dispatchDirective.unitCallsign;
  if (ticketSirenPolicy) ticketSirenPolicy.textContent = result.dispatchDirective.sirenPolicy;
  if (ticketEngineSource) ticketEngineSource.textContent = engineSource;
  if (ticketTacticalBrief) ticketTacticalBrief.textContent = result.dispatchDirective.tacticalBrief;

  if (result.incidentCode === INCIDENT_CODES.SILENT_INTERVENTION) {
    card?.classList.add("state-covert");
    if (ch6Led) ch6Led.className = "lamp lamp-amber";
    targetLockGroup?.setAttribute("opacity", "1");
  } else if (
    result.incidentCode === INCIDENT_CODES.CRITICAL_DISPATCH ||
    result.incidentCode === INCIDENT_CODES.MEDICAL_MVA
  ) {
    card?.classList.add("state-critical");
    ch6Card?.classList.add("slot-critical");
    if (ch6Led) ch6Led.className = "lamp lamp-critical";
    targetLockGroup?.setAttribute("opacity", "1");
  } else {
    targetLockGroup?.setAttribute("opacity", "0.28");
  }
}

function start60FpsRenderLoop() {
  const timeCanvas = document.getElementById("timeDomainCanvas");
  const freqCanvas = document.getElementById("frequencyCanvas");

  function renderFrame() {
    phaseTick += 0.075;
    const liveSample = interceptor.isActive
      ? interceptor.sampleTelemetry(async (nonVerbalSpike) => {
          await processAndBroadcastScenario(nonVerbalSpike);
        })
      : null;

    if (liveSample) {
      currentTelemetry = liveSample;
      const f0El = document.getElementById("metricF0");
      const jitEl = document.getElementById("metricJitter");
      const splEl = document.getElementById("metricSpl");
      const zcrEl = document.getElementById("metricZcr");
      const submetricCh6 = document.getElementById("submetric-CH-06");

      if (f0El) f0El.textContent = `${liveSample.f0Hz.toFixed(1)} Hz`;
      if (jitEl) jitEl.textContent = `${liveSample.jitterPercent.toFixed(2)} %`;
      if (splEl) splEl.textContent = `${liveSample.dbSpl.toFixed(1)} dB`;
      if (zcrEl) zcrEl.textContent = liveSample.zcr.toFixed(3);
      if (submetricCh6) {
        submetricCh6.textContent = `F0: ${liveSample.f0Hz.toFixed(0)}Hz | JIT: ${liveSample.jitterPercent.toFixed(2)}%`;
      }
    }

    drawMiniChannelWaveforms();
    if (timeCanvas) drawHiDpiOscilloscope(timeCanvas, liveSample);
    if (freqCanvas) drawHiDpiSpectrogram(freqCanvas, liveSample);

    requestAnimationFrame(renderFrame);
  }

  requestAnimationFrame(renderFrame);
}

function drawMiniChannelWaveforms() {
  channelCanvases.forEach(({ canvas, node }) => {
    if (!canvas) return;
    const { ctx, width: w, height: h } = configureHiDpiCanvas(canvas);
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, w, h);

    const isCh6 = node.isLiveHardwareChannel;
    const isCritical = isCh6 && currentTelemetry.jitterPercent >= 2.2;
    ctx.strokeStyle = isCritical ? "#ff2e4c" : isCh6 ? "#00b8ff" : "#00e599";
    ctx.lineWidth = 1.25;
    ctx.beginPath();

    const freqFactor = isCh6 ? currentTelemetry.f0Hz / 115 : node.baselineF0 / 125;
    const amp = isCh6 ? Math.min(11, (currentTelemetry.dbSpl - 30) / 5.8) : 5.5;

    for (let x = 0; x < w; x += 2) {
      const jitterNoise =
        isCh6 && currentTelemetry.jitterPercent > 1.8
          ? Math.sin(x * 0.85 + phaseTick * 4) * (currentTelemetry.jitterPercent * 1.05)
          : 0;
      const y = h / 2 + Math.sin(x * 0.055 * freqFactor + phaseTick) * amp + jitterNoise;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

function drawHiDpiOscilloscope(canvas, liveSample) {
  const { ctx, width: w, height: h } = configureHiDpiCanvas(canvas);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, w, h);

  // Draw calibrated graticule grid
  ctx.strokeStyle = "#10141f";
  ctx.lineWidth = 1;
  const stepX = w / 8;
  const stepY = h / 4;
  ctx.beginPath();
  for (let x = stepX; x < w; x += stepX) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = stepY; y < h; y += stepY) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  const isStressed = currentTelemetry.jitterPercent >= 2.0;
  ctx.strokeStyle = isStressed ? "#ff2e4c" : "#00e599";
  ctx.lineWidth = 1.65;
  ctx.beginPath();

  if (liveSample && liveSample.timeDomainData) {
    const buf = liveSample.timeDomainData;
    const slice = w / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const x = i * slice;
      const y = (0.5 + buf[i] * 0.44) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    const f0Ratio = currentTelemetry.f0Hz / 95;
    const amp = Math.min(46, Math.max(7, (currentTelemetry.dbSpl - 30) * 0.64));
    const jitterMod = currentTelemetry.jitterPercent * 2.15;
    for (let x = 0; x < w; x++) {
      const harmonic =
        Math.sin(x * 0.044 * f0Ratio + phaseTick * 1.75) * amp +
        Math.sin(x * 0.18 + phaseTick * 5.0) * jitterMod;
      const y = h / 2 + harmonic;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function drawHiDpiSpectrogram(canvas, liveSample) {
  const { ctx, width: w, height: h } = configureHiDpiCanvas(canvas);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#10141f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  const barCount = 52;
  const gap = 2;
  const barWidth = (w - gap * (barCount - 1)) / barCount;
  const peakBin = Math.min(barCount - 4, Math.max(3, Math.round((currentTelemetry.f0Hz / 500) * 28)));

  for (let i = 0; i < barCount; i++) {
    let magnitude = 0;
    if (liveSample && liveSample.frequencyData) {
      magnitude = liveSample.frequencyData[i * 2] / 255;
    } else {
      const dist = Math.abs(i - peakBin);
      magnitude = Math.max(
        0.07,
        Math.exp(-(dist * dist) / (currentTelemetry.jitterPercent > 2 ? 18 : 8)) *
          (currentTelemetry.dbSpl / 100)
      );
    }

    const barHeight = Math.min(h - 8, magnitude * (h - 10));
    ctx.fillStyle =
      i === peakBin
        ? "#ff2e4c"
        : currentTelemetry.jitterPercent >= 2.0
        ? "#ffb020"
        : "#00b8ff";
    ctx.fillRect(i * (barWidth + gap), h - barHeight, barWidth, barHeight);
  }
}

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

function exportIncidentJson() {
  const payload = lastAuditPacket || {
    system: "DHVANI-CAD v3.2.0",
    status: "ERSS_NOMINAL_STANDBY",
    psapNode: "AP-GNT-NAMBURU-04",
    timestamp: new Date().toISOString(),
    telemetry: currentTelemetry
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DHVANI_ERSS112_INCIDENT_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initDashboard);
}
