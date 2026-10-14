/**
 * @fileoverview Automated verification suite for DHVANI-CAD DSP & Dual-Threshold Triage Engine.
 * Run via: `npm test` or `node --test tests/triageEngine.test.js`
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRMSDecibels,
  computeZeroCrossingRate,
  estimateFundamentalFrequencyF0,
  computeGlottalJitterPercent
} from "../src/dsp/acousticAnalyzer.js";
import { evaluateDhvaniTriage, INCIDENT_CODES } from "../src/core/triageEngine.js";

test("DSP Suite: computeRMSDecibels and computeZeroCrossingRate calculate accurate signal metrics", () => {
  const sampleRate = 48000;
  const freq = 200;
  const buffer = new Float32Array(2048);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }

  const { rms, dbSpl } = computeRMSDecibels(buffer);
  const zcr = computeZeroCrossingRate(buffer);
  const { f0Hz } = estimateFundamentalFrequencyF0(buffer, sampleRate);

  assert.ok(rms > 0.34 && rms < 0.36, `Expected RMS near 0.3535, got ${rms}`);
  assert.ok(dbSpl > 85, `Expected high SPL for 0.5 amplitude sine wave, got ${dbSpl}`);
  assert.ok(zcr > 0.005 && zcr < 0.02, `Expected nominal ZCR, got ${zcr}`);
  assert.ok(Math.abs(f0Hz - 200) <= 5, `Expected F0 near 200 Hz, got ${f0Hz}`);
});

test("DSP Suite: computeGlottalJitterPercent distinguishes stable vs pathological tremor periods", () => {
  const calmPeriodsMs = [7.14, 7.15, 7.14, 7.16, 7.15, 7.14];
  const tremorPeriodsMs = [4.2, 4.9, 4.1, 4.8, 4.0, 4.7];

  const calmJitter = computeGlottalJitterPercent(calmPeriodsMs);
  const tremorJitter = computeGlottalJitterPercent(tremorPeriodsMs);

  assert.ok(calmJitter < 1.04, `Calm speech jitter should be below 1.04% norm, got ${calmJitter}%`);
  assert.ok(tremorJitter > 3.0, `Panicked vocal tremor should exceed 3.0%, got ${tremorJitter}%`);
});

test("DHVANI False-Positive Filter: High-threat Telugu/English keywords with calm vocal biometrics are suppressed", () => {
  const decision = evaluateDhvaniTriage({
    transcript: "Rey mama kapadandra, ee exam nannu champesthundi, help me bro!",
    f0Hz: 142.0,
    jitterPercent: 0.62,
    dbSpl: 65.0,
    zcr: 0.07
  });

  assert.equal(decision.incidentCode, INCIDENT_CODES.FALSE_POSITIVE);
  assert.ok(decision.keywordIndex >= 70, "Should detect high lexical keyword weight");
  assert.ok(decision.compositeThreatScore < 35, "Composite score must remain suppressed below 35");
  assert.equal(decision.dispatchDirective.dispatchRequired, false);
});

test("Active Assault Triage: Bilingual distress keywords paired with high F0 and glottal jitter trigger P1 Dispatch", () => {
  const decision = evaluateDhvaniTriage({
    transcript: "Kapadandi! Somebody please help me, leave me alone!",
    f0Hz: 368.5,
    jitterPercent: 4.85,
    dbSpl: 94.0,
    zcr: 0.21
  });

  assert.equal(decision.incidentCode, INCIDENT_CODES.CRITICAL_DISPATCH);
  assert.ok(decision.compositeThreatScore >= 85);
  assert.equal(decision.dispatchDirective.dispatchRequired, true);
  assert.equal(decision.dispatchDirective.sirenPolicy, "PRIORITY_1_ACTIVE_SIRENS");
});

test("Covert Hostage Whisper: Low-dB whispered plea with high jitter triggers COVERT_NO_SIRENS protocol", () => {
  const decision = evaluateDhvaniTriage({
    transcript: "Please help, someone broke into the house, hiding in bedroom",
    f0Hz: 214.0,
    jitterPercent: 3.92,
    dbSpl: 41.5,
    zcr: 0.26
  });

  assert.equal(decision.incidentCode, INCIDENT_CODES.SILENT_INTERVENTION);
  assert.equal(decision.dispatchDirective.dispatchRequired, true);
  assert.equal(decision.dispatchDirective.sirenPolicy, "COVERT_NO_SIRENS");
});

test("Non-Verbal Highway MVA: High-energy impact acoustics trigger 108 trauma dispatch without speech", () => {
  const decision = evaluateDhvaniTriage({
    transcript: "",
    f0Hz: 295.0,
    jitterPercent: 3.4,
    dbSpl: 98.5,
    zcr: 0.31,
    backgroundTags: ["Glass Shatter Transient", "Tire Skid"]
  });

  assert.equal(decision.incidentCode, INCIDENT_CODES.MEDICAL_MVA);
  assert.equal(decision.dispatchDirective.dispatchRequired, true);
});
