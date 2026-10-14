/**
 * @fileoverview AP Telecom Circle (MCC-MNC 404-73) SIP/RTP Trunk & Cell-ID Registry
 * Coordinates calibrated to Guntur-Namburu-Vijayawada NH-16 emergency corridor.
 */

export const TELECOM_NODES = Object.freeze([
  {
    channelId: "CH-01",
    cellId: "GNT-NMB-04B",
    sectorName: "Namburu Highway Corridor (VVITU Sector)",
    lac: 4102,
    sipTrunk: "SIP-AP-404-01",
    lat: 16.3458,
    lng: 80.5284,
    rssiDbm: -64,
    baselineF0: 134,
    baselineJitter: 0.52,
    nearestPatrol: "PCR-GNT-14",
    nearestMed: "108-AMB-NMB-02",
    isLiveHardwareChannel: false
  },
  {
    channelId: "CH-02",
    cellId: "GNT-BRO-02A",
    sectorName: "Brodipet Commercial Grid",
    lac: 4101,
    sipTrunk: "SIP-AP-404-02",
    lat: 16.3067,
    lng: 80.4365,
    rssiDbm: -71,
    baselineF0: 168,
    baselineJitter: 0.64,
    nearestPatrol: "PCR-GNT-08",
    nearestMed: "108-AMB-GNT-01",
    isLiveHardwareChannel: false
  },
  {
    channelId: "CH-03",
    cellId: "GNT-NTR-07C",
    sectorName: "NTR Transit Terminal Hub",
    lac: 4101,
    sipTrunk: "SIP-AP-404-03",
    lat: 16.2991,
    lng: 80.4572,
    rssiDbm: -68,
    baselineF0: 149,
    baselineJitter: 0.58,
    nearestPatrol: "PCR-GNT-03",
    nearestMed: "108-AMB-GNT-04",
    isLiveHardwareChannel: false
  },
  {
    channelId: "CH-04",
    cellId: "MGL-AIIMS-03D",
    sectorName: "Mangalagiri Highway Interchange",
    lac: 4105,
    sipTrunk: "SIP-AP-404-04",
    lat: 16.4307,
    lng: 80.5525,
    rssiDbm: -74,
    baselineF0: 122,
    baselineJitter: 0.47,
    nearestPatrol: "PCR-MGL-11",
    nearestMed: "108-AMB-MGL-01",
    isLiveHardwareChannel: false
  },
  {
    channelId: "CH-05",
    cellId: "VJA-BENZ-09A",
    sectorName: "Vijayawada Benz Circle NH-16",
    lac: 4108,
    sipTrunk: "SIP-AP-404-05",
    lat: 16.4971,
    lng: 80.6534,
    rssiDbm: -69,
    baselineF0: 176,
    baselineJitter: 0.71,
    nearestPatrol: "PCR-VJA-22",
    nearestMed: "108-AMB-VJA-05",
    isLiveHardwareChannel: false
  },
  {
    channelId: "CH-06",
    cellId: "GNT-LIVE-06X",
    sectorName: "Primary RTP Acoustic Intercept Line",
    lac: 4102,
    sipTrunk: "RTP-DIRECT-PCM16",
    lat: 16.3462,
    lng: 80.5249,
    rssiDbm: -58,
    baselineF0: 140,
    baselineJitter: 0.55,
    nearestPatrol: "PCR-GNT-14",
    nearestMed: "108-AMB-NMB-02",
    isLiveHardwareChannel: true
  }
]);

export const FORENSIC_PRESETS = Object.freeze({
  BENIGN_JOKE: {
    id: "BENIGN_JOKE",
    label: "VECTOR A // CASUAL BILINGUAL JOKE",
    transcript: "Rey mama kapadandra, ee PromptWars coding nannu champesthundi, help me bro!",
    detectedLanguage: "Bilingual te-IN / en-IN",
    f0Hz: 142.4,
    jitterPercent: 0.62,
    dbSpl: 66.8,
    zcr: 0.072,
    backgroundTags: ["Indoor Ambient Room Tone", "Laughter Harmonics Detected"]
  },
  ACTIVE_ASSAULT: {
    id: "ACTIVE_ASSAULT",
    label: "VECTOR B // HIGH-STRESS DISTRESS SCREAM",
    transcript: "Kapadandi! Somebody please help me, leave me alone, champesthunnaru!",
    detectedLanguage: "Bilingual te-IN / en-IN",
    f0Hz: 368.5,
    jitterPercent: 4.85,
    dbSpl: 94.2,
    zcr: 0.215,
    backgroundTags: ["Acute Vocal Cord Tension", "Blunt Impact / Struggle Acoustics"]
  },
  COVERT_HOSTAGE: {
    id: "COVERT_HOSTAGE",
    label: "VECTOR C // COVERT HOSTAGE WHISPER",
    transcript: "Please help... someone broke into the house... I am hiding inside the bedroom, do not make noise.",
    detectedLanguage: "en-IN",
    f0Hz: 214.0,
    jitterPercent: 3.92,
    dbSpl: 41.5,
    zcr: 0.264,
    backgroundTags: ["Unvoiced Fricative Whisper", "Hyperventilation Tremor", "Footsteps Nearby"]
  },
  HIGHWAY_MVA: {
    id: "HIGHWAY_MVA",
    label: "VECTOR D // NH-16 VEHICULAR IMPACT",
    transcript: "[Non-verbal distress groan] Accident near highway toll... bleeding...",
    detectedLanguage: "en-IN",
    f0Hz: 296.0,
    jitterPercent: 3.45,
    dbSpl: 98.6,
    zcr: 0.312,
    backgroundTags: ["High-Energy Metallic Impulse", "Glass Shatter Transient (3.8kHz)", "Tire Skid"]
  }
});
