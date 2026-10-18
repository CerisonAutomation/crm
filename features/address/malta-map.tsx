"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import L from "leaflet";

// ─── Types ──────────────────────────────────────────────────────────

export interface MapMarker {
  lat: number;
  lng: number;
  title?: string;
  description?: string;
}

interface MaltaMapProps {
  markers?: MapMarker[];
  center?: [number, number];
  zoom?: number;
  onMapClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (marker: MapMarker) => void;
  className?: string;
  showUserLocation?: boolean;
  height?: string;
}

// ─── Malta Default Center ──────────────────────────────────────────

const MALTA_CENTER: [number, number] = [35.9375, 14.3754];
const MALTA_BOUNDS: [[number, number], [number, number]] = [
  [35.7, 14.1], // SW
  [36.1, 14.6], // NE
];

// ─── Component ─────────────────────────────────────────────────────

export function MaltaMap({
  markers = [],
  center = MALTA_CENTER,
  zoom = 11,
  onMapClick,
  onMarkerClick,
  className,
  showUserLocation = false,
  height = "300px",
}: MaltaMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let map: L.Map | null = null;

    async function initMap() {
      try {
        const leaflet = await import("leaflet");
        leafletRef.current = leaflet;
        const L = leaflet.default;

        // Fix default marker icons
        delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
          iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
          shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
        });

        map = L.map(mapRef.current!, {
          center,
          zoom,
          maxBounds: MALTA_BOUNDS,
          maxBoundsViscosity: 1.0,
          minZoom: 9,
          maxZoom: 18,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);

        map.on("click", (e: L.LeafletMouseEvent) => {
          onMapClick?.(e.latlng.lat, e.latlng.lng);
        });

        mapInstanceRef.current = map;
        setIsLoading(false);
      } catch (err) {
        setError("Failed to load map");
        setIsLoading(false);
      }
    }

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;

    const L = (leafletRef.current as unknown as { default: typeof import("leaflet") }).default;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add new markers
    markers.forEach((marker) => {
      const m = L.marker([marker.lat, marker.lng], {
        title: marker.title,
      }).addTo(mapInstanceRef.current!);

      if (marker.description) {
        m.bindPopup(`<strong>${marker.title}</strong><br/>${marker.description}`);
      }

      m.on("click", () => onMarkerClick?.(marker));
      markersRef.current.push(m);
    });

    // Fit bounds if markers exist
    if (markers.length > 0) {
      const group = L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.1));
    }
  }, [markers, onMarkerClick]);

  // Get user location
  useEffect(() => {
    if (!showUserLocation) return;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        },
        () => {
          setError("Location access denied");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      setError("Geolocation not supported");
    }
  }, [showUserLocation]);

  // Add user location marker
  useEffect(() => {
    if (!mapInstanceRef.current || !userLocation || !leafletRef.current) return;

    const L = (leafletRef.current as unknown as { default: typeof import("leaflet") }).default;

    const userMarker = L.circleMarker(userLocation, {
      radius: 8,
      fillColor: "#3b82f6",
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
    }).addTo(mapInstanceRef.current);

    userMarker.bindPopup("Your location");
  }, [userLocation]);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border", className)}>
      <div
        ref={mapRef}
        style={{ height, width: "100%" }}
        className="z-0"
        role="application"
        aria-label="Map of Malta"
      />

      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <div className="absolute bottom-2 left-2 right-2 z-10 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {showUserLocation && userLocation && (
        <button
          onClick={() => {
            mapInstanceRef.current?.setView(userLocation, 15);
          }}
          className="absolute bottom-4 right-4 z-10 rounded-full bg-background p-2 shadow-md hover:bg-accent"
          aria-label="Center on my location"
        >
          <Navigation className="h-4 w-4" />
        </button>
      )}

      {markers.length === 0 && !isLoading && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          <MapPin className="mr-1 inline h-3 w-3" />
          Click map to select location
        </div>
      )}
    </div>
  );
}
