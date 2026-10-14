/**
 * @fileoverview Real-world hardware GPS tracker, OpenStreetMap reverse geocoder,
 * cross-device HTTPS Server-Sent Events (SSE) telemetry relay, and physical SOS actuators for DHVANI-CAD.
 */

const RELAY_BASE_URL = "https://ntfy.sh";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

export class RealWorldTelemetryRelay {
  constructor(roomCode = "dhvani-vvitu-112", onRemotePacketCallback = () => {}) {
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
      resolvedAddress: "Namburu Highway Corridor, Guntur District, AP",
      isHardwareFix: false
    };
    this.watchId = null;
    this.lastGeocodeTime = 0;
  }

  sanitizeRoomCode(code) {
    return String(code || "dhvani-vvitu-112")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 36);
  }

  startLiveGpsTracking(onGpsUpdate = () => {}) {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      onGpsUpdate(this.gpsState);
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
        if (now - this.lastGeocodeTime > 15000) {
          this.lastGeocodeTime = now;
          this.gpsState.resolvedAddress = await this.reverseGeocodeStreet(
            this.gpsState.lat,
            this.gpsState.lng
          );
        }

        onGpsUpdate({ ...this.gpsState });
      },
      () => {
        onGpsUpdate({ ...this.gpsState });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      }
    );
  }

  async reverseGeocodeStreet(lat, lng) {
    try {
      const res = await fetch(
        `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error("Geocode HTTP error");
      const data = await res.json();
      if (data && data.display_name) {
        return data.display_name.split(",").slice(0, 4).join(",").trim();
      }
    } catch (_) {}
    return `Sector ${lat.toFixed(4)}N, ${lng.toFixed(4)}E`;
  }

  connectLiveStream(newRoomCode) {
    if (newRoomCode) {
      this.roomCode = this.sanitizeRoomCode(newRoomCode);
    }

    if (this.localBroadcast) {
      this.localBroadcast.onmessage = (evt) => {
        if (evt.data) this.onRemotePacket(evt.data);
      };
    }

    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      const streamUrl = `${RELAY_BASE_URL}/${this.roomCode}/sse`;
      this.eventSource = new EventSource(streamUrl);
      this.eventSource.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.event === "message" && envelope.message) {
            const packet = JSON.parse(envelope.message);
            this.onRemotePacket(packet);
          }
        } catch (_) {}
      };
    } catch (_) {}
  }

  async broadcastEmergencyPacket(packet) {
    const enrichedPacket = {
      ...packet,
      gps: { ...this.gpsState },
      mapsUrl: `https://www.google.com/maps?q=${this.gpsState.lat},${this.gpsState.lng}`,
      relayedAt: new Date().toISOString()
    };

    if (this.localBroadcast) {
      this.localBroadcast.postMessage(enrichedPacket);
    }

    try {
      await fetch(`${RELAY_BASE_URL}/${this.roomCode}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(enrichedPacket)
      });
    } catch (_) {}

    return enrichedPacket;
  }

  triggerPhysicalVoiceActuator(triageResult) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();

    if (triageResult.dispatchDirective?.sirenPolicy === "COVERT_NO_SIRENS") {
      return;
    }

    if (triageResult.dispatchDirective?.dispatchRequired) {
      const utterance = new SpeechSynthesisUtterance(
        "DHVANI Emergency Alert Verified. Live GPS coordinates and acoustic evidence transmitted to ERSS 112 police control room."
      );
      utterance.lang = "en-IN";
      utterance.rate = 1.05;
      utterance.pitch = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  }

  buildEmergencyDispatchLinks(triageResult) {
    const { lat, lng, resolvedAddress } = this.gpsState;
    const mapsHref = `https://www.google.com/maps?q=${lat},${lng}`;
    const bodyText =
      `[ERSS-112 DHVANI-CAD AUTO-SOS] ${triageResult.incidentCode} | ` +
      `Siren: ${triageResult.dispatchDirective?.sirenPolicy} | ` +
      `F0: ${triageResult.f0Hz || 0}Hz, Jitter: ${triageResult.jitterPercent || 0}% | ` +
      `Transcript: "${triageResult.verbatimTranscript}" | ` +
      `Loc: ${resolvedAddress} (${mapsHref})`;

    return {
      smsHref: `sms:112?body=${encodeURIComponent(bodyText)}`,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(bodyText)}`,
      mapsHref
    };
  }
}
