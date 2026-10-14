/**
 * @fileoverview Time-domain & spectral acoustic feature extraction module for DHVANI-CAD.
 * Implements RMS loudness (dBFS/SPL), Zero-Crossing Rate (ZCR),
 * Normalized Autocorrelation F0 estimation, and Glottal Jitter perturbation.
 */

export function computeRMSDecibels(buffer) {
  if (!buffer || buffer.length === 0) {
    return { rms: 0, dbfs: -100, dbSpl: 30.0 };
  }

  let sumSquares = 0;
  const len = buffer.length;
  for (let i = 0; i < len; i++) {
    const sample = buffer[i];
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / len);
  const clampedRms = Math.max(rms, 1e-7);
  const dbfs = 20 * Math.log10(clampedRms);
  const dbSpl = Math.min(115, Math.max(30, Number((105 + dbfs * 1.15).toFixed(1))));

  return {
    rms: Number(rms.toFixed(5)),
    dbfs: Number(dbfs.toFixed(2)),
    dbSpl
  };
}

export function computeZeroCrossingRate(buffer) {
  if (!buffer || buffer.length < 2) {
    return 0;
  }

  let crossings = 0;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i] >= 0 && buffer[i - 1] < 0) || (buffer[i] < 0 && buffer[i - 1] >= 0)) {
      crossings++;
    }
  }

  return Number((crossings / (buffer.length - 1)).toFixed(4));
}

export function estimateFundamentalFrequencyF0(buffer, sampleRate = 48000) {
  if (!buffer || buffer.length < 512) {
    return { f0Hz: 0, confidence: 0, detectedPeriodsMs: [] };
  }

  const minHz = 75;
  const maxHz = 500;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(buffer.length / 2));

  let energy = 0;
  for (let i = 0; i < buffer.length; i++) {
    energy += buffer[i] * buffer[i];
  }
  if (energy / buffer.length < 1e-5) {
    return { f0Hz: 0, confidence: 0, detectedPeriodsMs: [] };
  }

  let bestCorrelation = -1;
  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    const limit = buffer.length - lag;

    for (let i = 0; i < limit; i++) {
      const a = buffer[i];
      const b = buffer[i + lag];
      sum += a * b;
      normA += a * a;
      normB += b * b;
    }

    const denom = Math.sqrt(normA * normB);
    const corr = denom > 0 ? sum / denom : 0;

    if (corr > bestCorrelation) {
      bestCorrelation = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < 0.22) {
    return { f0Hz: 0, confidence: Number(Math.max(0, bestCorrelation).toFixed(2)), detectedPeriodsMs: [] };
  }

  const f0Hz = Number((sampleRate / bestLag).toFixed(1));
  const detectedPeriodsMs = extractGlottalPeriodsMs(buffer, sampleRate, bestLag);

  return {
    f0Hz,
    confidence: Number(bestCorrelation.toFixed(2)),
    detectedPeriodsMs
  };
}

function extractGlottalPeriodsMs(buffer, sampleRate, expectedLagSamples) {
  const periodsMs = [];
  const windowRadius = Math.max(4, Math.floor(expectedLagSamples * 0.28));
  let currentIdx = 0;

  let firstPeak = 0;
  for (let i = 1; i < Math.min(expectedLagSamples, buffer.length); i++) {
    if (buffer[i] > buffer[firstPeak]) {
      firstPeak = i;
    }
  }
  currentIdx = firstPeak;

  while (currentIdx + expectedLagSamples + windowRadius < buffer.length) {
    const targetCenter = currentIdx + expectedLagSamples;
    let localPeakIdx = targetCenter - windowRadius;
    let maxVal = -Infinity;

    for (let j = targetCenter - windowRadius; j <= targetCenter + windowRadius; j++) {
      if (buffer[j] > maxVal) {
        maxVal = buffer[j];
        localPeakIdx = j;
      }
    }

    const cycleSamples = localPeakIdx - currentIdx;
    if (cycleSamples > 0) {
      periodsMs.push((cycleSamples / sampleRate) * 1000);
    }
    currentIdx = localPeakIdx;
  }

  return periodsMs;
}

export function computeGlottalJitterPercent(periodsMs) {
  if (!Array.isArray(periodsMs) || periodsMs.length < 3) {
    return 0.45;
  }

  let diffSum = 0;
  let periodSum = 0;
  const n = periodsMs.length;

  for (let i = 0; i < n; i++) {
    periodSum += periodsMs[i];
    if (i < n - 1) {
      diffSum += Math.abs(periodsMs[i] - periodsMs[i + 1]);
    }
  }

  const meanDiff = diffSum / (n - 1);
  const meanPeriod = periodSum / n;

  if (meanPeriod <= 0) {
    return 0.45;
  }

  const rawJitter = (meanDiff / meanPeriod) * 100;
  return Number(Math.min(8.5, Math.max(0.15, rawJitter)).toFixed(2));
}

export class LiveAudioInterceptor {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.timeBuffer = null;
    this.freqBuffer = null;
    this.isActive = false;
    this.recognition = null;
    this.rollingPeakTelemetry = { f0Hz: 140, jitterPercent: 0.55, dbSpl: 60, zcr: 0.06 };
    this.lastAnomalyTime = 0;
  }

  async startContinuousGuardian(onAutonomousTrigger = () => {}) {
    if (typeof window === "undefined" || !navigator.mediaDevices) {
      throw new Error("Web Audio hardware capture is unavailable.");
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.analyser);

    this.timeBuffer = new Float32Array(this.analyser.fftSize);
    this.freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
    this.isActive = true;

    this.startContinuousSpeechLoop(onAutonomousTrigger);
  }

  startContinuousSpeechLoop(onAutonomousTrigger) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-IN";

    this.recognition.onresult = (event) => {
      let latestTranscript = "";
      let isFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        latestTranscript += event.results[i][0].transcript + " ";
        if (event.results[i].isFinal) {
          isFinal = true;
        }
      }

      const cleaned = latestTranscript.trim();
      if (cleaned.length >= 3 && (isFinal || cleaned.split(" ").length >= 3)) {
        const snapshot = this.sampleTelemetry() || this.rollingPeakTelemetry;
        onAutonomousTrigger({
          transcript: cleaned,
          f0Hz: Math.max(snapshot.f0Hz, this.rollingPeakTelemetry.f0Hz),
          jitterPercent: Math.max(snapshot.jitterPercent, this.rollingPeakTelemetry.jitterPercent),
          dbSpl: snapshot.dbSpl,
          zcr: snapshot.zcr,
          backgroundTags: ["Live Continuous Hardware Microphone Stream"]
        });
        this.rollingPeakTelemetry = { f0Hz: 135, jitterPercent: 0.55, dbSpl: 55, zcr: 0.06 };
      }
    };

    this.recognition.onend = () => {
      if (this.isActive) {
        try {
          this.recognition.start();
        } catch (_) {}
      }
    };

    try {
      this.recognition.start();
    } catch (_) {}
  }

  sampleTelemetry(onNonVerbalAnomaly) {
    if (!this.isActive || !this.analyser) {
      return null;
    }

    this.analyser.getFloatTimeDomainData(this.timeBuffer);
    this.analyser.getByteFrequencyData(this.freqBuffer);

    const { dbSpl, dbfs } = computeRMSDecibels(this.timeBuffer);
    const zcr = computeZeroCrossingRate(this.timeBuffer);
    const { f0Hz, detectedPeriodsMs } = estimateFundamentalFrequencyF0(
      this.timeBuffer,
      this.audioContext.sampleRate
    );
    const jitterPercent =
      detectedPeriodsMs.length >= 3 ? computeGlottalJitterPercent(detectedPeriodsMs) : 0.52;

    const currentF0 = f0Hz > 0 ? f0Hz : 132.0;

    if (dbSpl > 42) {
      this.rollingPeakTelemetry.f0Hz = Math.max(this.rollingPeakTelemetry.f0Hz, currentF0);
      this.rollingPeakTelemetry.jitterPercent = Math.max(
        this.rollingPeakTelemetry.jitterPercent,
        jitterPercent
      );
      this.rollingPeakTelemetry.dbSpl = Math.max(this.rollingPeakTelemetry.dbSpl, dbSpl);
      this.rollingPeakTelemetry.zcr = Math.max(this.rollingPeakTelemetry.zcr, zcr);
    }

    const now = Date.now();
    if (
      onNonVerbalAnomaly &&
      dbSpl >= 88 &&
      (currentF0 >= 285 || jitterPercent >= 2.5 || zcr >= 0.25) &&
      now - this.lastAnomalyTime > 5000
    ) {
      this.lastAnomalyTime = now;
      onNonVerbalAnomaly({
        transcript: "[Non-verbal high-decibel scream / acoustic impact transient]",
        f0Hz: currentF0,
        jitterPercent: Math.max(jitterPercent, 3.1),
        dbSpl,
        zcr,
        backgroundTags: ["Autonomous Non-Verbal Acoustic Spike (>88 dB SPL)"]
      });
    }

    return {
      dbSpl,
      dbfs,
      zcr,
      f0Hz: currentF0,
      jitterPercent,
      timeDomainData: this.timeBuffer,
      frequencyData: this.freqBuffer
    };
  }

  stop() {
    this.isActive = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (_) {}
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
    }
  }
}
