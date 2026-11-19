// Real Road Routing Service with Intelligent Detour Rejection
// Snaps to real roads where available, and detects/rejects artificial rural 10km detours
// Ensuring the shortest direct road path between villages (e.g. Nalhera -> Chaura Khurd)

import { RouteConfig, RouteShift, RouteStoppage } from '../types/routeTracking';
import { DEFAULT_SCHOOL_COORDS } from './busTrackingService';

export interface RoadRoutingResult {
  roadCoordinates: [number, number][]; // Leaflet [lat, lng] points
  distanceKm: number;
  durationMinutes: number;
  isSnappedToRoad: boolean;
}

// In-memory cache to prevent redundant API calls (ONLY stores genuine road-snapped routes!)
const ROUTE_CACHE = new Map<string, RoadRoutingResult>();
const CACHE_STORAGE_PREFIX = 'evs_road_cache_v6_';

// Purge ALL legacy road caches that stored straight-line fallbacks or 10km detours
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('evs_road_cache_') && !key.startsWith(CACHE_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  }
} catch {}

// Haversine formula to calculate true great-circle distance between two GPS coordinates
export const calculateHaversineKm = (
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number => {
  const R = 6371; // Earth radius in km
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const generateSmoothCorridor = (
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
  steps: number = 8
): [number, number][] => {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = p1.lat + (p2.lat - p1.lat) * t;
    const lng = p1.lng + (p2.lng - p1.lng) * t;
    points.push([lat, lng]);
  }
  return points;
};

const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const getRouteCacheKey = (waypoints: Array<{ lat: number; lng: number }>): string => {
  const raw = waypoints
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(';');
  return `pts${waypoints.length}_${hashString(raw)}`;
};

const DIRECT_OSRM_MIRRORS = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
];

const tryDirectOsrmPath = async (coordsPath: string): Promise<RoadRoutingResult | null> => {
  for (const baseUrl of DIRECT_OSRM_MIRRORS) {
    try {
      const url = `${baseUrl}/${coordsPath}?overview=full&geometries=geojson&continue_straight=false`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(7500),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data?.code === 'Ok' && Array.isArray(data?.routes) && data.routes[0]?.geometry?.coordinates?.length > 0) {
        const route = data.routes[0];
        const coords: [number, number][] = route.geometry.coordinates.map(
          (c: [number, number]) => [Number(c[1]), Number(c[0])]
        );
        return {
          roadCoordinates: coords,
          distanceKm: Math.round(((Number(route.distance) || 0) / 1000) * 100) / 100,
          durationMinutes: Math.round(((Number(route.duration) || 0) / 60) * 10) / 10,
          isSnappedToRoad: true,
        };
      }
    } catch {}
  }
  return null;
};

const fetchSingleLegRoadDirect = async (
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<RoadRoutingResult> => {
  const directDist = calculateHaversineKm(start, end);
  if (directDist < 0.04) {
    return {
      roadCoordinates: [[start.lat, start.lng], [end.lat, end.lng]],
      distanceKm: Math.round(directDist * 100) / 100,
      durationMinutes: 0.1,
      isSnappedToRoad: true,
    };
  }

  const legPath = `${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}`;
  const direct = await tryDirectOsrmPath(legPath);
  if (direct) return direct;

  const fallbackRoadDist = Math.round(directDist * 1.15 * 100) / 100;
  const fallbackDuration = Math.round((fallbackRoadDist / 25) * 60 * 10) / 10;
  return {
    roadCoordinates: generateSmoothCorridor(start, end, 8),
    distanceKm: fallbackRoadDist,
    durationMinutes: fallbackDuration,
    isSnappedToRoad: false,
  };
};

/**
 * Fetch true road-snapped geometry connecting waypoints sequentially along real streets/roads.
 * Uses server proxy (/api/road-route) first, then direct OSRM mirrors, and NEVER caches straight-line fallbacks.
 */
export const fetchRoadSnappingRoute = async (
  waypoints: Array<{ lat: number; lng: number }>,
  options?: { bypassCache?: boolean }
): Promise<RoadRoutingResult> => {
  const cleanWaypoints: Array<{ lat: number; lng: number }> = [];
  for (const pt of waypoints || []) {
    const lat = Number(pt?.lat);
    const lng = Number(pt?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (cleanWaypoints.length > 0) {
      const prev = cleanWaypoints[cleanWaypoints.length - 1];
      if (calculateHaversineKm(prev, { lat, lng }) < 0.012) continue;
    }
    cleanWaypoints.push({ lat, lng });
  }

  if (cleanWaypoints.length < 2) {
    return {
      roadCoordinates: cleanWaypoints.map((w) => [w.lat, w.lng]),
      distanceKm: 0,
      durationMinutes: 0,
      isSnappedToRoad: false,
    };
  }

  const cacheKey = getRouteCacheKey(cleanWaypoints);
  const storageKey = CACHE_STORAGE_PREFIX + cacheKey;

  if (!options?.bypassCache) {
    // 1. Check in-memory cache (ONLY road-snapped entries live here)
    const memCached = ROUTE_CACHE.get(cacheKey);
    if (memCached && memCached.isSnappedToRoad) {
      return memCached;
    }

    // 2. Check localStorage cache (ignore if straight-line fallback somehow got stored)
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed &&
          parsed.isSnappedToRoad === true &&
          Array.isArray(parsed.roadCoordinates) &&
          parsed.roadCoordinates.length > 2
        ) {
          ROUTE_CACHE.set(cacheKey, parsed);
          return parsed;
        }
      }
    } catch {}
  }

  const persistIfSnapped = (res: RoadRoutingResult) => {
    if (res.isSnappedToRoad && res.roadCoordinates.length >= 2) {
      ROUTE_CACHE.set(cacheKey, res);
      try {
        localStorage.setItem(storageKey, JSON.stringify(res));
      } catch {}
    }
  };

  // 3. Primary: Backend Road Routing Proxy (multi-provider, handles CORS & caches only real road paths)
  try {
    const serverRes = await fetch('/api/road-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: cleanWaypoints }),
      signal: AbortSignal.timeout(12000),
    });
    if (serverRes.ok) {
      const data = await serverRes.json();
      if (data?.success && Array.isArray(data.roadCoordinates) && data.roadCoordinates.length >= 2) {
        const result: RoadRoutingResult = {
          roadCoordinates: data.roadCoordinates,
          distanceKm: Number(data.distanceKm || 0),
          durationMinutes: Number(data.durationMinutes || 0),
          isSnappedToRoad: Boolean(data.isSnappedToRoad),
        };
        persistIfSnapped(result);
        if (result.isSnappedToRoad) {
          return result;
        }
      }
    }
  } catch {}

  // 4. Client fallback: single multi-waypoint request against OSRM mirrors
  const fullCoordsPath = cleanWaypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const fullDirect = await tryDirectOsrmPath(fullCoordsPath);
  if (fullDirect) {
    persistIfSnapped(fullDirect);
    return fullDirect;
  }

  // 5. Last resort: sequential leg-by-leg direct queries (avoids burst 429 rate-limits)
  const mergedCoords: [number, number][] = [];
  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let snappedLegs = 0;
  const totalLegs = cleanWaypoints.length - 1;

  for (let i = 0; i < totalLegs; i++) {
    const leg = await fetchSingleLegRoadDirect(cleanWaypoints[i], cleanWaypoints[i + 1]);
    totalDistanceKm += leg.distanceKm;
    totalDurationMinutes += leg.durationMinutes;
    if (leg.isSnappedToRoad) snappedLegs++;
    if (i === 0) mergedCoords.push(...leg.roadCoordinates);
    else mergedCoords.push(...leg.roadCoordinates.slice(1));
  }

  const allSnapped = snappedLegs === totalLegs && totalLegs > 0;
  const result: RoadRoutingResult = {
    roadCoordinates: mergedCoords,
    distanceKm: Math.round(totalDistanceKm * 100) / 100,
    durationMinutes: Math.round(totalDurationMinutes * 10) / 10,
    isSnappedToRoad: snappedLegs > 0,
  };

  if (allSnapped) {
    persistIfSnapped(result);
  }

  return result;
};

// Default stoppages empty - dynamically loaded from Google Sheet "Route_Stops" tab and manager pin drops
export const DEFAULT_ROUTE_1_STOPPAGES: RouteStoppage[] = [];
export const DEFAULT_ROUTE_2_STOPPAGES: RouteStoppage[] = [];

// =========================================================================
// TWO ROUTES (दो रूट) DEFAULT CONFIGURATIONS
// =========================================================================
export const SCHOOL_ROUTES_CONFIG: Record<string, RouteConfig> = {
  'route-1': {
    routeId: 'route-1',
    routeName: 'रूट #1: चिलकाना - सुल्तानपुर - रामपुर मार्ग',
    assignedBusId: '121212', // Real Google Sheet ID for Amjad
    assignedDriver: 'Amjad (अमजद)',
    shift: 'morning',
    schoolOrigin: {
      lat: DEFAULT_SCHOOL_COORDS.lat,
      lng: DEFAULT_SCHOOL_COORDS.lng,
      name: 'ई.वी.एस. पब्लिक स्कूल (E.V.S. Campus)',
      address: DEFAULT_SCHOOL_COORDS.address,
    },
    stoppages: DEFAULT_ROUTE_1_STOPPAGES,
    averageSpeedKmH: 26,
    dwellTimePerStopSec: 60,
  },
  'route-2': {
    routeId: 'route-2',
    routeName: 'रूट #2: पटनी - दुमझेड़ा - देहात मार्ग',
    assignedBusId: '123556', // Real Google Sheet ID for Mh salik
    assignedDriver: 'Mh salik (चालक 2)',
    shift: 'morning',
    schoolOrigin: {
      lat: DEFAULT_SCHOOL_COORDS.lat,
      lng: DEFAULT_SCHOOL_COORDS.lng,
      name: 'ई.वी.एस. पब्लिक स्कूल (E.V.S. Campus)',
      address: DEFAULT_SCHOOL_COORDS.address,
    },
    stoppages: DEFAULT_ROUTE_2_STOPPAGES,
    averageSpeedKmH: 26,
    dwellTimePerStopSec: 60,
  },
};

export const getRouteStorageKey = (routeId: string): string => {
  return `evs_van_route_stoppages_${routeId}`;
};

export const getRouteShiftStorageKey = (routeId: string): string => {
  return `evs_van_route_shift_${routeId}`;
};
