# DHVANI-CAD: AI-Powered Acoustic Biometric & Autonomous Emergency Response Platform

> **Problem Statement Alignment:** Public Safety and Emergency Response | Smart Cities and Transportation | Healthcare and Community Wellness | Citizen Engagement and Public Services | Accessibility and Inclusive Communities  
> **Technology Stack:** Google Gemini (`gemini-2.5-flash`), Google AI Studio Structured Outputs, Web Audio API DSP (Autocorrelation $F_0$ & Glottal Jitter), OpenStreetMap Nominatim GIS Geocoding, Real-Time HTTPS SSE Telemetry Relay.

---

## 1. Executive Summary & Real-World Problem Statement Alignment

Communities across India face severe bottlenecks in emergency response (`NG-ERSS Dial 112 / 100 / 108`). While state command centers receive up to 16 lakh calls daily, over **99.5% are false alarms, prank calls, or non-emergency inquiries** that human telecommunicators must manually screen—delaying life-saving dispatch to 15–30 minutes. Simultaneously, existing smartphone SOS applications fail during active physical assaults, highway vehicular collisions, or domestic hostage intrusions because victims cannot unlock a keypad or speak aloud without alerting an attacker.

**DHVANI-CAD** uses intelligent automation, real-time acoustic signal processing, and Google Gemini multimodal reasoning to solve these real-world challenges across five interconnected domains:

1. **Public Safety and Emergency Response:** Automatically intercepts distress calls and filters out casual jokes/pranks by verifying that danger keywords are accompanied by involuntary vocal cord tremor.
2. **Smart Cities and Transportation:** Detects high-energy vehicular crash acoustics (`> 90 dB SPL` tire skids, glass shatter transients) along highway corridors (such as NH-16 Guntur–Vijayawada) and dispatches 108 trauma ambulances without requiring manual dialing.
3. **Accessibility and Inclusive Communities:** Enables zero-touch, hands-free emergency triggering for visually impaired, injured, or non-verbal citizens, as well as covert whisper detection (`<= 48 dB SPL`) for victims hiding from intruders.
4. **Healthcare and Community Wellness:** Accelerates golden-hour trauma triage by transmitting pre-verified vocal stress biometrics and geodetic street coordinates directly to 108 Emergency Medical Services.
5. **Citizen Engagement and Public Services:** Eliminates PSAP queue congestion for C-DAC ERSS-112, AP Police Shakti, and Telangana T-Safe ride-monitoring infrastructures.

---

## 2. Indian Public Safety Ecosystem Benchmark

| System | Primary Trigger | Prank / Joke Suppression | Covert Whisper / Coercion Detection | Siren Protocol Routing |
| :--- | :--- | :--- | :--- | :--- |
| **C-DAC ERSS-112 (National)** | Manual Dial / IVR | Manual Human Operator | No | Manual |
| **AP Police Shakti App** | App Button / Shake | None (Raw Clip Upload) | No (Requires Physical Shake) | Standard Siren |
| **Telangana Police T-Safe** | Periodic IVR Ride Call | Keypad / Verbal Check | Vulnerable to Coerced Speech | Standard Siren |
| **AP Transport Project Abhaya** | Physical IoT Panic Button | None (High False Positives) | No | Standard Siren |
| **DHVANI-CAD (This Project)** | **Zero-Touch VAD + Dual-Gate** | **Automated ($F_0$ + Glottal Jitter)** | **Yes (`< 48 dB SPL` + ZCR Gate)** | **Automated Covert / Active** |

---

## 3. Acoustic DSP & Mathematical Formulation

Implemented in `src/dsp/acousticAnalyzer.js` and `src/core/triageEngine.js` using pure 48 kHz time-domain PCM analysis (`Float32Array`):

* **Normalized Time-Domain Autocorrelation ($F_0$ Pitch Estimation):** Extracts Fundamental Frequency across the 75 Hz – 500 Hz vocal band. Acute sympathetic nervous system stress tenses the cricothyroid muscle, pushing $F_0$ above the 85–220 Hz conversational baseline.
* **Relative Glottal Jitter (%):** Measures cycle-to-cycle pitch period perturbation across consecutive glottal pulses ($T_i$):

  $$\text{Jitter (\%)} = \frac{\frac{1}{N-1}\sum_{i=1}^{N-1}\vert{}T_i - T_{i+1}\vert{}}{\frac{1}{N}\sum_{i=1}^{N}T_i} \times 100$$

  Calm conversational speech remains below `1.04%`. Genuine vocal terror drives glottal jitter above `1.80% - 6.50%`.

* **Dual-Threshold Fusion Gate:** Blocks false alarms when high-threat bilingual words (`"kapadandra"`, `"champesthundi"`, `"help"`) are spoken with stable glottal periodicity (`Jitter < 1.35%`).

---

## 4. Security, Privacy & WCAG 2.1 AA Accessibility

* **Zero Hardcoded Credentials:** API keys are never stored in source code; optional runtime keys are sanitized and isolated in browser `sessionStorage`.
* **Content Security Policy (CSP):** Strict CSP headers restrict script execution and external connections to `self`, Google Gemini API, OpenStreetMap Nominatim, and the HTTPS SSE relay.
* **Accessibility:** Built with semantic HTML5 landmarks, keyboard navigation skip-links, high-contrast tabular readouts, and `aria-live="assertive"` dispatch alerts.

---

