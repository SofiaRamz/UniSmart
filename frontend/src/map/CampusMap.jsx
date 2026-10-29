// Vista del mapa (Leaflet). Los datos (pines) llegan por props desde la API; el plano base vive en campusBase.js.
import L from "leaflet";
import { useEffect, useRef } from "react";
import { LOCATION_KINDS } from "../lib/format";
import { CAMPUS_BASE, CAMPUS_CENTER } from "./campusBase";

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function pinIcon(kind, selected) {
  const glyph = LOCATION_KINDS[kind]?.glyph || "•";
  return L.divIcon({
    className: "campus-pin-wrap",
    html: `<span class="campus-pin kind-${kind}${selected ? " is-selected" : ""}"><span>${escapeHtml(glyph)}</span></span>`,
    iconSize: [30, 36],
    iconAnchor: [15, 34],
    popupAnchor: [0, -30],
  });
}

export default function CampusMap({ locations = [], selectedId, onSelect, pickMode = false, pickedPoint, onPick, showTiles = false, className = "h-[420px]" }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const pickMarker = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);
  onSelectRef.current = onSelect;
  onPickRef.current = onPick;

  useEffect(() => {
    const map = L.map(el.current, { zoomControl: true, attributionControl: true, minZoom: 15, maxZoom: 20 });
    map.attributionControl.setPrefix("Leaflet");
    if (showTiles) {
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        maxNativeZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
    }
    const base = L.geoJSON(CAMPUS_BASE, {
      interactive: false,
      style: (f) => ({ className: `campus-shape kind-${f.properties.kind}`, weight: f.properties.kind === "camino" ? 3 : 1 }),
    }).addTo(map);
    map.fitBounds(base.getBounds(), { padding: [12, 12] });
    if (!map.getZoom()) map.setView(CAMPUS_CENTER, 18);
    map.on("click", (e) => {
      if (onPickRef.current) onPickRef.current({ latitude: +e.latlng.lat.toFixed(6), longitude: +e.latlng.lng.toFixed(6) });
    });
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      markers.current.clear();
    };
  }, [showTiles]);

  // Pines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current.clear();
    locations.forEach((loc) => {
      const marker = L.marker([loc.latitude, loc.longitude], {
        icon: pinIcon(loc.kind, loc.id === selectedId),
        title: loc.name,
        keyboard: true,
        riseOnHover: true,
      })
        .bindPopup(
          `<strong>${escapeHtml(loc.name)}</strong><span class="campus-popup-kind">${escapeHtml(LOCATION_KINDS[loc.kind]?.label || loc.kind)}</span>${
            loc.description ? `<p>${escapeHtml(loc.description)}</p>` : ""
          }`,
          { maxWidth: 260 },
        )
        .on("click", () => onSelectRef.current?.(loc.id))
        .addTo(map);
      markers.current.set(loc.id, marker);
    });
  }, [locations, selectedId]);

  // Enfoque del pin seleccionado
  useEffect(() => {
    const map = mapRef.current;
    const marker = selectedId != null ? markers.current.get(selectedId) : null;
    if (!map || !marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 18), { duration: 0.5 });
    marker.openPopup();
  }, [selectedId, locations]);

  // Punto elegido al crear/editar ubicaciones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.toggle("leaflet-crosshair", pickMode);
    if (pickMarker.current) {
      pickMarker.current.remove();
      pickMarker.current = null;
    }
    if (pickMode && pickedPoint && Number.isFinite(pickedPoint.latitude)) {
      pickMarker.current = L.marker([pickedPoint.latitude, pickedPoint.longitude], {
        icon: L.divIcon({ className: "campus-pin-wrap", html: '<span class="campus-pick"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
      }).addTo(map);
    }
  }, [pickMode, pickedPoint]);

  return <div ref={el} className={`campus-map w-full overflow-hidden rounded-xl border border-line ${className}`} role="region" aria-label="Mapa del campus" />;
}
