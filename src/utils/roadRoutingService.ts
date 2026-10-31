// Real Road Routing Service using Open Source Routing Machine (OSRM)
// Snaps straight route lines to actual highways, village roads, and streets for free (No Google Maps billing required)

import { RouteConfig, RouteShift, RouteStoppage } from '../types/routeTracking';
import { DEFAULT_SCHOOL_COORDS } from './busTrackingService';

export interface RoadRoutingResult {
  roadCoordinates: [number, number][]; // Leaflet [lat, lng] points following real roads
  distanceKm: number;
  durationMinutes: number;
  isSnappedToRoad: boolean;
}

// In-memory cache to prevent redundant API calls
const ROUTE_CACHE = new Map<string, RoadRoutingResult>();
const CACHE_STORAGE_PREFIX = 'evs_road_cache_v3_';

// Purge any old legacy road caches that caused collision/truncation to 1 stop
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('evs_road_cache_') && !key.startsWith('evs_road_cache_v3_')) {
        localStorage.removeItem(key);
      }
    });
  }
} catch {}

// Simple deterministic hash for long waypoint sequences
const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

// Build a unique cache key from waypoints (includes count + hashed coords)
const getRouteCacheKey = (waypoints: Array<{ lat: number; lng: number }>): string => {
  const raw = waypoints
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(';');
  return `pts${waypoints.length}_${hashString(raw)}`;
};

/**
 * Fetch true road geometry connecting waypoints sequentially using OSRM
 * Transforms GeoJSON [lng, lat] coordinates into Leaflet [lat, lng] format.
 */
export const fetchRoadSnappingRoute = async (
  waypoints: Array<{ lat: number; lng: number }>
): Promise<RoadRoutingResult> => {
  if (!waypoints || waypoints.length < 2) {
    const coords: [number, number][] = (waypoints || []).map((w) => [w.lat, w.lng]);
    return {
      roadCoordinates: coords,
      distanceKm: 0,
      durationMinutes: 0,
      isSnappedToRoad: false,
    };
  }

  const cacheKey = getRouteCacheKey(waypoints);
  const storageKey = CACHE_STORAGE_PREFIX + cacheKey;

  // 1. Check in-memory cache
  if (ROUTE_CACHE.has(cacheKey)) {
    return ROUTE_CACHE.get(cacheKey)!;
  }

  // 2. Check localStorage cache
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.roadCoordinates) && parsed.roadCoordinates.length > 0) {
        ROUTE_CACHE.set(cacheKey, parsed);
        return parsed;
      }
    }
  } catch {}

  // 3. Prepare OSRM coordinates: lon,lat;lon,lat;...
  const coordsParam = waypoints.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(osrmUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const rawCoords: [number, number][] = route.geometry.coordinates || [];

        // Convert [lng, lat] GeoJSON to [lat, lng] Leaflet
        const leafLetCoords: [number, number][] = rawCoords.map((coord) => [coord[1], coord[0]]);

        const distanceKm = Math.round(((route.distance || 0) / 1000) * 100) / 100;
        const durationMinutes = Math.round(((route.duration || 0) / 60) * 10) / 10;

        const result: RoadRoutingResult = {
          roadCoordinates: leafLetCoords,
          distanceKm,
          durationMinutes,
          isSnappedToRoad: true,
        };

        // Cache the successful result with unique non-colliding key
        ROUTE_CACHE.set(cacheKey, result);
        try {
          localStorage.setItem(storageKey, JSON.stringify(result));
        } catch {}

        return result;
      }
    }
  } catch (err) {
    console.warn('OSRM road routing fetch note (falling back to direct path):', err);
  }

  // Fallback: If network issue or offline, connect points directly
  const fallbackCoords: [number, number][] = waypoints.map((w) => [w.lat, w.lng]);
  return {
    roadCoordinates: fallbackCoords,
    distanceKm: 0,
    durationMinutes: 0,
    isSnappedToRoad: false,
  };
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
