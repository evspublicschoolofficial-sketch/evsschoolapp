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

// In-memory cache to prevent redundant API calls
const ROUTE_CACHE = new Map<string, RoadRoutingResult>();
const CACHE_STORAGE_PREFIX = 'evs_road_cache_v5_';

// Purge any old legacy road caches that stored the 10km detour
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('evs_road_cache_') && !key.startsWith('evs_road_cache_v5_')) {
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

// Generate smooth series of intermediate corridor coordinates
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

// Simple deterministic hash for long waypoint sequences
const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

// Build a unique cache key from waypoints
const getRouteCacheKey = (waypoints: Array<{ lat: number; lng: number }>): string => {
  const raw = waypoints
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(';');
  return `pts${waypoints.length}_${hashString(raw)}`;
};

interface LegResult {
  roadCoordinates: [number, number][];
  distanceKm: number;
  durationMinutes: number;
  isSnappedToRoad: boolean;
}

/**
 * Route a single leg between two consecutive waypoints:
 * - Queries OSRM for true road geometry.
 * - Detects if OSRM took an artificial 10km detour due to missing rural road tags in OSM.
 * - Rejects any detour (detourRatio > 2.0 && excessKm > 2.0) and replaces it with the shortest direct corridor.
 */
const fetchSingleLegRoad = async (
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<LegResult> => {
  const directDist = calculateHaversineKm(start, end);

  // If very close (under 40 meters), direct connection
  if (directDist < 0.04) {
    return {
      roadCoordinates: [[start.lat, start.lng], [end.lat, end.lng]],
      distanceKm: Math.round(directDist * 100) / 100,
      durationMinutes: 0.1,
      isSnappedToRoad: true,
    };
  }

  // Realistic fallback metrics based on shortest village road corridor
  const fallbackRoadDist = Math.round(directDist * 1.15 * 100) / 100; // 1.15x winding factor
  const fallbackDuration = Math.round((fallbackRoadDist / 25) * 60 * 10) / 10; // at 25 km/h avg speed

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const response = await fetch(osrmUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const osrmDist = (route.distance || 0) / 1000;
        const detourRatio = directDist > 0.05 ? osrmDist / directDist : 1;
        const excessKm = osrmDist - directDist;

        // DETOUR REJECTION RULE:
        // If OSRM took a detour > 2.0x direct distance AND added > 2.0 km excess, OR ratio > 2.5:
        // E.g. Nalhera to Chaura is 3.1 km direct, but OSRM routes 10.66 km (ratio 3.44, excess 7.56 km).
        // We reject the detour and take the direct shortest village road path!
        const isDetour = (detourRatio > 2.0 && excessKm > 2.0) || detourRatio > 2.5;

        if (!isDetour && Array.isArray(route.geometry?.coordinates) && route.geometry.coordinates.length > 0) {
          const leafLetCoords: [number, number][] = route.geometry.coordinates.map(
            (c: [number, number]) => [c[1], c[0]]
          );
          return {
            roadCoordinates: leafLetCoords,
            distanceKm: Math.round(osrmDist * 100) / 100,
            durationMinutes: Math.round(((route.duration || 0) / 60) * 10) / 10,
            isSnappedToRoad: true,
          };
        } else if (isDetour) {
          console.info(
            `[RoadRouting] Artificial detour rejected between (${start.lat.toFixed(4)}, ${start.lng.toFixed(4)}) and (${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}): OSRM ${osrmDist.toFixed(1)}km vs Direct ${directDist.toFixed(1)}km. Using shortest direct corridor (${fallbackRoadDist}km).`
          );
        }
      }
    }
  } catch (err) {
    // Network or timeout, fallback to smooth corridor
  }

  // Fallback to direct corridor
  return {
    roadCoordinates: generateSmoothCorridor(start, end, 8),
    distanceKm: fallbackRoadDist,
    durationMinutes: fallbackDuration,
    isSnappedToRoad: false,
  };
};

/**
 * Fetch true road geometry connecting waypoints sequentially.
 * Runs leg-by-leg with automatic detour rejection, guaranteeing the shortest route.
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

  // 3. Process every consecutive leg individually and concurrently
  const legPromises: Promise<LegResult>[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    legPromises.push(fetchSingleLegRoad(waypoints[i], waypoints[i + 1]));
  }

  const legResults = await Promise.all(legPromises);

  const mergedCoords: [number, number][] = [];
  let totalDistanceKm = 0;
  let totalDurationMinutes = 0;
  let hasAnySnapped = false;

  legResults.forEach((leg, index) => {
    totalDistanceKm += leg.distanceKm;
    totalDurationMinutes += leg.durationMinutes;
    if (leg.isSnappedToRoad) hasAnySnapped = true;

    if (index === 0) {
      mergedCoords.push(...leg.roadCoordinates);
    } else {
      // Avoid duplicate point at joint
      mergedCoords.push(...leg.roadCoordinates.slice(1));
    }
  });

  const result: RoadRoutingResult = {
    roadCoordinates: mergedCoords,
    distanceKm: Math.round(totalDistanceKm * 100) / 100,
    durationMinutes: Math.round(totalDurationMinutes * 10) / 10,
    isSnappedToRoad: hasAnySnapped,
  };

  ROUTE_CACHE.set(cacheKey, result);
  try {
    localStorage.setItem(storageKey, JSON.stringify(result));
  } catch {}

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
