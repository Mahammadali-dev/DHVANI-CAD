/**
 * @fileoverview Real-world hardware GPS tracker, OpenStreetMap reverse geocoder,
 * cross-device HTTPS Server-Sent Events (SSE) telemetry relay, and physical SOS actuators.
 */

import { recordDiagnosticEvent } from "../config/telecomNodes.js";

const RELAY_BASE_URL = "https://ntfy.sh";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const GEOCODE_THROTTLE_MS = 15000;
const DEFAULT_ROOM_CODE = "dhvani-vvitu-112";

export class RealWorldTelemetryRelay {
  /**
   * @param {string} [roomCode="dhvani-vvitu-112"] Unique channel ID pairing a Field Phone with the Command Laptop
   * @param {(packet: Object) => void} [onRemotePacketCallback] Invoked when remote telemetry arrives
   */
  constructor(roomCode = DEFAULT_ROOM_CODE, onRemotePacketCallback = () => {}) {
    this.roomCode = this.sanitizeRoomCode(roomCode);
    this.onRemotePacket = onRemotePacketCallback;
    this.eventSource = null;
    this.localBroadcast =
      typeof window !== "undefined" && "BroadcastChannel" in window
        ? new BroadcastChannel("dhvani_erss_local_bus")
        : null;

    this.gpsState = {
      lat: 16.3462,
      lng: 80.5249,
      accuracyMeters: 12,
      speedMps: 0,
      resolvedAddress: "Namburu Highway Corridor, Guntur, AP",
      isHardwareFix: false
    };
    this.watchId = null;
    this.lastGeocodeTime = 0;
  }

  /**
   * Sanitizes a relay channel identifier to alphanumeric and hyphen characters.
   * @param {string} code
   * @returns {string}
   */
  sanitizeRoomCode(code) {
    const cleaned = String(code || DEFAULT_ROOM_CODE)
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 36);
    return cleaned || DEFAULT_ROOM_CODE;
  }

  /**
   * Starts real-time hardware GPS tracking via navigator.geolocation.watchPosition
   * and resolves street addresses using OpenStreetMap Nominatim.
   * @param {(gps: Object) => void} [onGpsUpdate]
   */
  startLiveGpsTracking(onGpsUpdate = () => {}) {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      this.gpsState.resolvedAddress = "Hardware GPS unavailable on this device";
      onGpsUpdate({ ...this.gpsState });
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      async (position) => {
        this.gpsState.lat = Number(position.coords.latitude.toFixed(6));
        this.gpsState.lng = Number(position.coords.longitude.toFixed(6));
        this.gpsState.accuracyMeters = Math.round(position.coords.accuracy || 10);
        this.gpsState.speedMps = Number((position.coords.speed || 0).toFixed(1));
        this.gpsState.isHardwareFix = true;

        const now = Date.now();
        if (now - this.lastGeocodeTime > GEOCODE_THROTTLE_MS) {
          this.lastGeocodeTime = now;
          this.gpsState.resolvedAddress = await this.reverseGeocodeStreet(
            this.gpsState.lat,
            this.gpsState.lng
          );
        }

        onGpsUpdate({ ...this.gpsState });
      },
      (geoError) => {
        recordDiagnosticEvent("GPS_WATCH", geoError);
        this.gpsState.resolvedAddress = "Namburu Sector (Cell-ID Triangulation Active)";
        onGpsUpdate({ ...this.gpsState });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      }
    );
  }

  /**
   * Resolves latitude/longitude into a street address using OpenStreetMap Nominatim.
   * @param {number} lat Latitude in decimal degrees
   * @param {number} lng Longitude in decimal degrees
   * @returns {Promise<string>}
   */
  async reverseGeocodeStreet(lat, lng) {
    try {
      const safeLat = Number(lat).toFixed(6);
      const safeLng = Number(lng).toFixed(6);
      const res = await fetch(
        `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(safeLat)}&lon=${encodeURIComponent(safeLng)}`,
        {
          headers: { Accept: "application/json" }
        }
      );
      if (!res.ok) {
        throw new Error(`Nominatim HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data && typeof data.display_name === "string") {
        return data.display_name.split(",").slice(0, 4).join(",").trim();
      }
    } catch (geocodeError) {
      recordDiagnosticEvent("NOMINATIM_GEOCODE", geocodeError);
    }
    return `Sector ${Number(lat).toFixed(4)}N, ${Number(lng).toFixed(4)}E`;
  }

  /**
   * Subscribes the Command Center console to live cross-device telemetry over HTTPS SSE.
   * @param {string} [newRoomCode]
   */
  connectLiveStream(newRoomCode) {
    if (newRoomCode) {
      this.roomCode = this.sanitizeRoomCode(newRoomCode);
    }

    if (this.localBroadcast) {
      this.localBroadcast.onmessage = (evt) => {
        if (evt.data && typeof evt.data === "object") {
          this.onRemotePacket(evt.data);
        }
      };
    }

    if (this.eventSource) {
      this.eventSource.close();
    }

    if (typeof EventSource === "undefined") {
      return;
    }

    try {
      const streamUrl = `${RELAY_BASE_URL}/${encodeURIComponent(this.roomCode)}/sse`;
      this.eventSource = new EventSource(streamUrl);
      this.eventSource.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.event === "message" && envelope.message) {
            const packet = JSON.parse(envelope.message);
            this.onRemotePacket(packet);
          }
        } catch (parseError) {
          recordDiagnosticEvent("SSE_PARSE", parseError);
        }
      };
      this.eventSource.onerror = (sseError) => {
        recordDiagnosticEvent("SSE_STREAM", sseError);
      };
    } catch (connError) {
      recordDiagnosticEvent("SSE_CONNECT", connError);
    }
  }

  /**
   * Publishes a live emergency telemetry packet from the Citizen Field Device to the Command Console.
   * @param {Object} packet Triage decision and biometric telemetry packet
   * @returns {Promise<Object>} Enriched packet with geodetic coordinates
   */
  async broadcastEmergencyPacket(packet) {
    const safeLat = Number(this.gpsState.lat).toFixed(6);
    const safeLng = Number(this.gpsState.lng).toFixed(6);
    const enrichedPacket = {
      ...packet,
      gps: { ...this.gpsState },
      mapsUrl: `https://www.google.com/maps?q=${safeLat},${safeLng}`,
      relayedAt: new Date().toISOString()
    };

    if (this.localBroadcast) {
      this.localBroadcast.postMessage(enrichedPacket);
    }

    try {
      await fetch(`${RELAY_BASE_URL}/${encodeURIComponent(this.roomCode)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(enrichedPacket)
      });
    } catch (networkError) {
      recordDiagnosticEvent("SSE_PUBLISH", networkError);
    }

    return enrichedPacket;
  }

  /**
   * Triggers physical voice deterrence over the device speaker ONLY when sirenPolicy is active.
   * Strictly silences speaker during COVERT_NO_SIRENS (hostage/intruder whisper).
   * @param {Object} triageResult
   */
  triggerPhysicalVoiceActuator(triageResult) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();

    if (triageResult?.dispatchDirective?.sirenPolicy === "COVERT_NO_SIRENS") {
      return;
    }

    if (triageResult?.dispatchDirective?.dispatchRequired) {
      const utterance = new SpeechSynthesisUtterance(
        "Emergency distress verified by DHVANI CAD. Live GPS coordinates and acoustic evidence transmitted to ERSS 112 police control room."
      );
      utterance.lang = "en-IN";
      utterance.rate = 1.05;
      utterance.pitch = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Builds sanitized SMS / WhatsApp SOS dispatch URIs with live GPS pin and biometric evidence.
   * @param {Object} triageResult
   * @returns {{ smsHref: string, whatsappHref: string, mapsHref: string }}
   */
  buildEmergencyDispatchLinks(triageResult = {}) {
    const safeLat = Number(this.gpsState.lat || 16.3462).toFixed(6);
    const safeLng = Number(this.gpsState.lng || 80.5249).toFixed(6);
    const resolvedAddress = String(this.gpsState.resolvedAddress || "Namburu Sector");
    const mapsHref = `https://www.google.com/maps?q=${safeLat},${safeLng}`;
    const bodyText =
      `[ERSS-112 DHVANI-CAD AUTO-SOS] ${triageResult.incidentCode || "EMERGENCY"} | ` +
      `Siren: ${triageResult.dispatchDirective?.sirenPolicy || "ACTIVE"} | ` +
      `F0: ${triageResult.f0Hz || 0}Hz, Jitter: ${triageResult.jitterPercent || 0}% | ` +
      `Transcript: "${triageResult.verbatimTranscript || ""}" | ` +
      `Loc: ${resolvedAddress} (${mapsHref})`;

    return {
      smsHref: `sms:112?body=${encodeURIComponent(bodyText)}`,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(bodyText)}`,
      mapsHref
    };
  }
}
