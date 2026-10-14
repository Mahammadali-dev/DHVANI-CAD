/**
 * @fileoverview DHVANI-CAD Dual-Threshold Acoustic Biometric & Semantic Fusion Engine.
 * Cross-verifies bilingual (te-IN / en-IN) lexical threat weights against involuntary
 * glottal jitter and F0 pitch elevation to eliminate false positives while catching covert distress.
 */

import { SYSTEM_CONSTANTS } from "../config/telecomNodes.js";

export const INCIDENT_CODES = Object.freeze({
  CRITICAL_DISPATCH: "ERSS_P1_CRITICAL_DISPATCH",
  SILENT_INTERVENTION: "ERSS_P1_SILENT_INTERVENTION",
  MEDICAL_MVA: "ERSS_P1_MEDICAL_MVA",
  FALSE_POSITIVE: "ERSS_FALSE_POSITIVE_BENIGN",
  NOMINAL_TRAFFIC: "ERSS_NOMINAL_STANDBY"
});

const MAX_TRANSCRIPT_CHARS = 600;

const LEXICON_VECTORS = Object.freeze([
  { term: "kapadandi", weight: 48, lang: "te-IN" },
  { term: "kapadandra", weight: 42, lang: "te-IN" },
  { term: "champesthunnaru", weight: 52, lang: "te-IN" },
  { term: "champesthundi", weight: 38, lang: "te-IN" },
  { term: "odileyandi", weight: 45, lang: "te-IN" },
  { term: "manta", weight: 40, lang: "te-IN" },
  { term: "help", weight: 42, lang: "en-IN" },
  { term: "save me", weight: 50, lang: "en-IN" },
  { term: "leave me", weight: 46, lang: "en-IN" },
  { term: "intruder", weight: 48, lang: "en-IN" },
  { term: "broke into", weight: 48, lang: "en-IN" },
  { term: "hiding", weight: 40, lang: "en-IN" },
  { term: "accident", weight: 46, lang: "en-IN" },
  { term: "bleeding", weight: 46, lang: "en-IN" },
  { term: "fire", weight: 42, lang: "en-IN" },
  { term: "gun", weight: 55, lang: "en-IN" },
  { term: "knife", weight: 50, lang: "en-IN" },
  { term: "kill", weight: 36, lang: "en-IN" }
]);

/**
 * Computes lexical threat score and matched keywords from a transcript string.
 * @param {string} [transcript=""] Input speech transcript
 * @returns {{ keywordIndex: number, matchedTerms: string[], detectedLanguage: string }}
 */
export function scoreSemanticLexicon(transcript = "") {
  const normalized = String(transcript || "").toLowerCase().trim();
  if (!normalized) {
    return {
      keywordIndex: 0,
      matchedTerms: [],
      detectedLanguage: "Non-Verbal / Acoustic Biometric Only"
    };
  }

  let rawScore = 0;
  const matchedTerms = [];
  const detectedLangs = new Set();

  for (const entry of LEXICON_VECTORS) {
    if (normalized.includes(entry.term)) {
      rawScore += entry.weight;
      matchedTerms.push(entry.term);
      detectedLangs.add(entry.lang);
    }
  }

  const detectedLanguage =
    detectedLangs.size > 1
      ? "Bilingual te-IN / en-IN"
      : detectedLangs.has("te-IN")
      ? "te-IN (Telugu)"
      : "en-IN (English)";

  return {
    keywordIndex: Math.min(100, rawScore),
    matchedTerms,
    detectedLanguage
  };
}

/**
 * Evaluates multimodal acoustic telemetry and semantic transcript using the DHVANI Dual-Threshold Gate.
 * @param {Object} [input={}] Telemetry and transcript frame
 * @param {string} [input.transcript] Speech transcript
 * @param {number} [input.f0Hz] Fundamental frequency in Hz
 * @param {number} [input.jitterPercent] Relative glottal jitter percentage
 * @param {number} [input.dbSpl] Sound pressure level in dB
 * @param {number} [input.zcr] Zero-crossing rate (0.0 to 1.0)
 * @param {string[]} [input.backgroundTags] Detected environmental acoustic tags
 * @returns {Object} Structured NG-ERSS 112 triage decision packet
 */
export function evaluateDhvaniTriage(input = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const transcript =
    typeof safeInput.transcript === "string"
      ? safeInput.transcript.slice(0, MAX_TRANSCRIPT_CHARS)
      : "";
  const f0Hz = Number.isFinite(safeInput.f0Hz) ? Math.max(0, safeInput.f0Hz) : 135;
  const jitterPercent = Number.isFinite(safeInput.jitterPercent)
    ? Math.max(0, safeInput.jitterPercent)
    : 0.55;
  const dbSpl = Number.isFinite(safeInput.dbSpl) ? Math.max(20, safeInput.dbSpl) : 60;
  const zcr = Number.isFinite(safeInput.zcr) ? Math.max(0, safeInput.zcr) : 0.06;
  const backgroundTags = Array.isArray(safeInput.backgroundTags) ? safeInput.backgroundTags : [];

  const { keywordIndex, matchedTerms, detectedLanguage } = scoreSemanticLexicon(transcript);

  const pitchStress = Math.min(100, Math.max(0, ((f0Hz - 165) / 210) * 100));
  const jitterStress = Math.min(100, Math.max(0, ((jitterPercent - 0.85) / 3.4) * 100));
  const intensityStress = dbSpl > 82 ? Math.min(100, ((dbSpl - 75) / 25) * 100) : 15;

  const isCovertWhisper =
    dbSpl <= SYSTEM_CONSTANTS.WHISPER_SPL_CEILING_DB &&
    jitterPercent >= SYSTEM_CONSTANTS.PATHOLOGICAL_JITTER_PCT &&
    (zcr >= SYSTEM_CONSTANTS.FRICATIVE_ZCR_THRESHOLD || keywordIndex >= 40);

  const hasCrashAcoustics =
    backgroundTags.some((tag) => /shatter|skid|impact|crash|metallic/i.test(String(tag))) ||
    (dbSpl >= 90 && zcr >= 0.25 && jitterPercent >= 2.5);

  let vocalStressIndex = Math.round(
    jitterStress * 0.52 + pitchStress * 0.33 + intensityStress * 0.15
  );

  if (isCovertWhisper) {
    vocalStressIndex = Math.max(vocalStressIndex, 89);
  }
  if (hasCrashAcoustics) {
    vocalStressIndex = Math.max(vocalStressIndex, 88);
  }
  vocalStressIndex = Math.min(100, Math.max(0, vocalStressIndex));

  const paralinguisticMarkers = buildParalinguisticMarkers(
    f0Hz,
    jitterPercent,
    dbSpl,
    zcr,
    isCovertWhisper
  );

  // CASE 1: False-Positive Joke Filter (High lexical threat words, calm glottal biometrics)
  if (keywordIndex >= 40 && vocalStressIndex < 38 && jitterPercent < 1.35 && !isCovertWhisper) {
    const suppressedScore = Math.min(
      34,
      Math.round(vocalStressIndex * 0.65 + keywordIndex * 0.15)
    );
    return {
      incidentCode: INCIDENT_CODES.FALSE_POSITIVE,
      detectedLanguage,
      verbatimTranscript: transcript || "[Calm conversational speech]",
      matchedKeywords: matchedTerms,
      keywordIndex,
      vocalStressIndex,
      compositeThreatScore: suppressedScore,
      paralinguisticMarkers: [
        ...paralinguisticMarkers,
        "Semantic-Biometric Mismatch: Trigger lexicon spoken with calm glottal periodicity"
      ],
      acousticEnvironment: backgroundTags.length
        ? backgroundTags
        : ["Benign Conversational Environment"],
      dispatchDirective: {
        dispatchRequired: false,
        unitCallsign: "NONE // SUPPRESSED",
        sirenPolicy: "STANDBY",
        tacticalBrief:
          "False positive suppressed. Distress keywords detected without involuntary vocal tremor."
      }
    };
  }

  // CASE 2: Covert Hostage / Domestic Intruder Whisper
  if (isCovertWhisper && (keywordIndex >= 35 || jitterPercent >= 3.0)) {
    const compositeThreatScore = Math.min(
      99,
      Math.max(88, Math.round(vocalStressIndex * 0.65 + keywordIndex * 0.35))
    );
    return {
      incidentCode: INCIDENT_CODES.SILENT_INTERVENTION,
      detectedLanguage,
      verbatimTranscript: transcript,
      matchedKeywords: matchedTerms,
      keywordIndex,
      vocalStressIndex,
      compositeThreatScore,
      paralinguisticMarkers,
      acousticEnvironment: backgroundTags.length
        ? backgroundTags
        : ["Low-dB Indoor Covert Environment"],
      dispatchDirective: {
        dispatchRequired: true,
        unitCallsign: "PCR-GNT-14 (TACTICAL INTERCEPT)",
        sirenPolicy: "COVERT_NO_SIRENS",
        tacticalBrief:
          "Caller whispering under acute vocal tremor. Dispatch patrol with sirens and beacons OFF."
      }
    };
  }

  // CASE 3: High-Impact Vehicular Collision / Non-Verbal Medical Emergency
  if (hasCrashAcoustics && vocalStressIndex >= 75) {
    const compositeThreatScore = Math.min(
      98,
      Math.max(85, Math.round(vocalStressIndex * 0.8 + keywordIndex * 0.2 + 10))
    );
    return {
      incidentCode: INCIDENT_CODES.MEDICAL_MVA,
      detectedLanguage,
      verbatimTranscript: transcript || "[Non-verbal impact & distress acoustics]",
      matchedKeywords: matchedTerms,
      keywordIndex,
      vocalStressIndex,
      compositeThreatScore,
      paralinguisticMarkers,
      acousticEnvironment: backgroundTags,
      dispatchDirective: {
        dispatchRequired: true,
        unitCallsign: "108-AMB-NMB-02 + PCR-GNT-14",
        sirenPolicy: "PRIORITY_1_ACTIVE_SIRENS",
        tacticalBrief:
          "High-energy vehicular impact signature verified. Dispatch 108 trauma ambulance and highway patrol."
      }
    };
  }

  // CASE 4: Active High-Decibel Assault / Life-Threatening Emergency
  const rawComposite = Math.round(vocalStressIndex * 0.6 + keywordIndex * 0.4);
  const synergyBoost = keywordIndex >= 50 && vocalStressIndex >= 65 ? 14 : 0;
  const compositeThreatScore = Math.min(100, rawComposite + synergyBoost);

  if (compositeThreatScore >= SYSTEM_CONSTANTS.DISPATCH_COMPOSITE_THRESHOLD) {
    return {
      incidentCode: INCIDENT_CODES.CRITICAL_DISPATCH,
      detectedLanguage,
      verbatimTranscript: transcript,
      matchedKeywords: matchedTerms,
      keywordIndex,
      vocalStressIndex,
      compositeThreatScore,
      paralinguisticMarkers,
      acousticEnvironment: backgroundTags.length
        ? backgroundTags
        : ["High-Decibel Distress Environment"],
      dispatchDirective: {
        dispatchRequired: true,
        unitCallsign: "PCR-GNT-14 (ERSS-112 RAPID RESPONSE)",
        sirenPolicy: "PRIORITY_1_ACTIVE_SIRENS",
        tacticalBrief:
          "Dual-threshold verified: Bilingual distress lexicon confirmed by acute glottal tremor and F0 spike."
      }
    };
  }

  return {
    incidentCode: INCIDENT_CODES.NOMINAL_TRAFFIC,
    detectedLanguage,
    verbatimTranscript: transcript || "[Ambient cellular voice stream]",
    matchedKeywords: matchedTerms,
    keywordIndex,
    vocalStressIndex,
    compositeThreatScore,
    paralinguisticMarkers,
    acousticEnvironment: backgroundTags.length ? backgroundTags : ["Nominal Carrier Traffic"],
    dispatchDirective: {
      dispatchRequired: false,
      unitCallsign: "NONE",
      sirenPolicy: "STANDBY",
      tacticalBrief:
        "Telemetry within nominal conversational bounds. Continuing passive RAM ring-buffer scan."
    }
  };
}

/**
 * Formats clinical acoustic biometric markers for PSAP audit logs.
 * @param {number} f0Hz
 * @param {number} jitterPercent
 * @param {number} dbSpl
 * @param {number} zcr
 * @param {boolean} isCovertWhisper
 * @returns {string[]}
 */
function buildParalinguisticMarkers(f0Hz, jitterPercent, dbSpl, zcr, isCovertWhisper) {
  const markers = [];
  if (f0Hz >= 270) {
    markers.push(
      `Elevated F0 Pitch (${f0Hz.toFixed(1)} Hz > ${SYSTEM_CONSTANTS.NOMINAL_F0_UPPER_HZ} Hz norm)`
    );
  } else {
    markers.push(`Nominal F0 Pitch (${f0Hz.toFixed(1)} Hz)`);
  }

  if (jitterPercent >= 1.8) {
    markers.push(
      `Pathological Glottal Jitter (${jitterPercent.toFixed(2)}% > ${SYSTEM_CONSTANTS.CLINICAL_JITTER_THRESHOLD_PCT}% norm)`
    );
  } else {
    markers.push(`Stable Glottal Periodicity (${jitterPercent.toFixed(2)}% Jitter)`);
  }

  if (isCovertWhisper) {
    markers.push(
      `Covert Unvoiced Whisper Signature (${dbSpl.toFixed(1)} dB SPL, ZCR ${zcr.toFixed(3)})`
    );
  }
  return markers;
}

export const evaluateShivaTriage = evaluateDhvaniTriage;
