/**
 * @fileoverview Google AI Studio & Vertex AI compatible Gemini 2.5 Flash Multimodal Client.
 * Provides structured JSON emergency triage with automatic deterministic edge DSP fallback.
 */

import { evaluateDhvaniTriage } from "../core/triageEngine.js";
import { recordDiagnosticEvent } from "../config/telecomNodes.js";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const SESSION_KEY_STORAGE_ID = "DHVANI_GEMINI_API_KEY";
const REQUEST_TIMEOUT_MS = 8000;

const RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: {
    incidentCode: {
      type: "STRING",
      enum: [
        "ERSS_P1_CRITICAL_DISPATCH",
        "ERSS_P1_SILENT_INTERVENTION",
        "ERSS_P1_MEDICAL_MVA",
        "ERSS_FALSE_POSITIVE_BENIGN",
        "ERSS_NOMINAL_STANDBY"
      ]
    },
    detectedLanguage: { type: "STRING" },
    verbatimTranscript: { type: "STRING" },
    keywordIndex: { type: "INTEGER" },
    vocalStressIndex: { type: "INTEGER" },
    compositeThreatScore: { type: "INTEGER" },
    paralinguisticMarkers: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    acousticEnvironment: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    dispatchDirective: {
      type: "OBJECT",
      properties: {
        dispatchRequired: { type: "BOOLEAN" },
        unitCallsign: { type: "STRING" },
        sirenPolicy: {
          type: "STRING",
          enum: ["PRIORITY_1_ACTIVE_SIRENS", "COVERT_NO_SIRENS", "STANDBY"]
        },
        tacticalBrief: { type: "STRING" }
      },
      required: ["dispatchRequired", "unitCallsign", "sirenPolicy", "tacticalBrief"]
    }
  },
  required: [
    "incidentCode",
    "detectedLanguage",
    "verbatimTranscript",
    "keywordIndex",
    "vocalStressIndex",
    "compositeThreatScore",
    "paralinguisticMarkers",
    "acousticEnvironment",
    "dispatchDirective"
  ]
});

const SYSTEM_INSTRUCTION = `You are DHVANI-CAD, an automated NG-ERSS 112 acoustic distress and paralinguistic triage agent for Public Safety and Emergency Response.
Cross-verify semantic distress words (in English and Telugu such as 'kapadandi', 'champesthunnaru', 'help', 'save me') against hardware DSP vocal biometrics (Fundamental Frequency F0 in Hz, Glottal Jitter %, SPL dB, and Zero-Crossing Rate).
1. FALSE POSITIVE FILTER: If high-threat words are spoken calmly or jokingly (low jitter < 1.35% and normal F0 < 210 Hz), return ERSS_FALSE_POSITIVE_BENIGN and compositeThreatScore < 35.
2. COVERT HOSTAGE WHISPER: If SPL is below 48 dB with elevated jitter (> 2.3%) or whispered pleas for help, return ERSS_P1_SILENT_INTERVENTION and sirenPolicy: COVERT_NO_SIRENS.
3. ACTIVE EMERGENCY: When both vocal stress and distress context align (or crash transients occur), return ERSS_P1_CRITICAL_DISPATCH or ERSS_P1_MEDICAL_MVA.`;

/**
 * Retrieves the runtime Gemini API key from browser sessionStorage.
 * @returns {string} Sanitized API key or empty string
 */
export function getStoredGeminiKey() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return "";
  }
  return (window.sessionStorage.getItem(SESSION_KEY_STORAGE_ID) || "").trim();
}

/**
 * Stores the user-provided Gemini API key in ephemeral sessionStorage after strict character sanitization.
 * @param {string} apiKey Raw user input key
 */
export function setStoredGeminiKey(apiKey) {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  const sanitized = String(apiKey || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (sanitized) {
    window.sessionStorage.setItem(SESSION_KEY_STORAGE_ID, sanitized);
  } else {
    window.sessionStorage.removeItem(SESSION_KEY_STORAGE_ID);
  }
}

/**
 * Performs multimodal acoustic triage via Gemini 2.5 Flash or falls back to local deterministic DSP engine.
 * @param {Object} [payload={}] Telemetry and audio payload
 * @returns {Promise<{ result: Object, engineSource: string, latencyMs: number }>}
 */
export async function analyzeEmergencyStream(payload = {}) {
  const startTime = performance.now();
  const apiKey = getStoredGeminiKey();
  const localBaseline = evaluateDhvaniTriage(payload);

  if (!apiKey) {
    return {
      result: localBaseline,
      engineSource: "LOCAL_DSP_AUTOCORRELATION_ENGINE",
      latencyMs: Math.max(4, Math.round(performance.now() - startTime))
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const parts = [
      {
        text: `Analyze this emergency telecom intercept frame.
Hardware DSP Telemetry:
- Fundamental Frequency (F0): ${payload.f0Hz || 140} Hz
- Glottal Jitter Perturbation: ${payload.jitterPercent || 0.55}%
- Acoustic Intensity: ${payload.dbSpl || 62} dB SPL
- Zero-Crossing Rate (ZCR): ${payload.zcr || 0.08}
- Preliminary Transcript / Context: "${payload.transcript || "Live audio capture"}"
- Environmental Tags: ${JSON.stringify(payload.backgroundTags || [])}`
      }
    ];

    if (payload.base64Audio && payload.mimeType) {
      parts.push({
        inlineData: {
          mimeType: String(payload.mimeType),
          data: String(payload.base64Audio)
        }
      });
    }

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA
        }
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Gemini API HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error("Empty structured payload from Gemini.");
    }

    const parsed = JSON.parse(rawText);
    return {
      result: {
        ...localBaseline,
        ...parsed,
        matchedKeywords: localBaseline.matchedKeywords
      },
      engineSource: "GEMINI_2.5_FLASH_NATIVE_AUDIO",
      latencyMs: Math.round(performance.now() - startTime)
    };
  } catch (error) {
    clearTimeout(timeoutId);
    recordDiagnosticEvent("GEMINI_SERVICE", error);
    return {
      result: localBaseline,
      engineSource: "LOCAL_DSP_FALLBACK",
      latencyMs: Math.round(performance.now() - startTime)
    };
  }
}
