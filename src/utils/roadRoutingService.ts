// Real Road Routing Service using Open Source Routing Machine (OSRM)
// Snaps straight route lines to actual highways, village roads, and streets for free (No Google Maps billing required)

import { RouteConfig, RouteShift } from '../types/routeTracking';
import { DEFAULT_SCHOOL_COORDS } from './busTrackingService';

export interface RoadRoutingResult {
  roadCoordinates: [number, number][]; // Leaflet [lat, lng] points following real roads
  distanceKm: number;
  durationMinutes: number;
  isSnappedToRoad: boolean;
}

// In-memory cache to prevent redundant API calls
const ROUTE_CACHE = new Map<string, RoadRoutingResult>();
const CACHE_STORAGE_PREFIX = 'evs_road_cache_';

// Build a unique cache key from waypoints
const getRouteCacheKey = (waypoints: Array<{ lat: number; lng: number }>): string => {
  return waypoints
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join(';');
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

  // 1. Check in-memory cache
  if (ROUTE_CACHE.has(cacheKey)) {
    return ROUTE_CACHE.get(cacheKey)!;
  }

  // 2. Check localStorage cache
  try {
    const saved = localStorage.getItem(CACHE_STORAGE_PREFIX + cacheKey.slice(0, 32));
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

        // Cache the successful result
        ROUTE_CACHE.set(cacheKey, result);
        try {
          localStorage.setItem(
            CACHE_STORAGE_PREFIX + cacheKey.slice(0, 32),
            JSON.stringify(result)
          );
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

// Default realistic stoppages aligned with real student villages around Sultanpur / Chilkana
export const DEFAULT_ROUTE_1_STOPPAGES = [
  {
    id: 'stop-r1-01',
    name: 'इब्राहिमपुरा (Ibrahimpura)',
    sequence: 1,
    lat: 30.0820,
    lng: 77.4580,
    scheduledTime: '07:15 AM',
    morningTime: '07:15 AM',
    eveningTime: '02:20 PM',
    villageName: 'Ibrahimpura',
    studentCount: 4,
    notes: 'मुख्य बस स्टैंड तिराहा',
  },
  {
    id: 'stop-r1-02',
    name: 'मजहर हसन चिलकाना (Majhar Hasan)',
    sequence: 2,
    lat: 30.0760,
    lng: 77.4690,
    scheduledTime: '07:25 AM',
    morningTime: '07:25 AM',
    eveningTime: '02:30 PM',
    villageName: 'Majhar hasan chilkana',
    studentCount: 5,
    notes: 'चिलकाना बाजार मोड़',
  },
  {
    id: 'stop-r1-03',
    name: 'कतला खुर्द (Katla Khurd)',
    sequence: 3,
    lat: 30.0710,
    lng: 77.4720,
    scheduledTime: '07:35 AM',
    morningTime: '07:35 AM',
    eveningTime: '02:40 PM',
    villageName: 'Katla khurd',
    studentCount: 6,
    notes: 'चौपाल एवं प्राथमिक स्कूल के पास',
  },
  {
    id: 'stop-r1-04',
    name: 'सीकरी खुर्द (Sikri Khurd)',
    sequence: 4,
    lat: 30.0650,
    lng: 77.4620,
    scheduledTime: '07:45 AM',
    morningTime: '07:45 AM',
    eveningTime: '02:50 PM',
    villageName: 'Sikri khurd',
    studentCount: 4,
    notes: 'सीकरी मुख्य संपर्क मार्ग',
  },
  {
    id: 'stop-r1-05',
    name: 'नलहेड़ा (Nalhera)',
    sequence: 5,
    lat: 30.0610,
    lng: 77.4480,
    scheduledTime: '07:55 AM',
    morningTime: '07:55 AM',
    eveningTime: '03:00 PM',
    villageName: 'Nalhera',
    studentCount: 3,
    notes: 'नलहेड़ा मोड़',
  },
  {
    id: 'stop-r1-06',
    name: 'ई.वी.एस. पब्लिक स्कूल (E.V.S. Campus)',
    sequence: 6,
    lat: DEFAULT_SCHOOL_COORDS.lat,
    lng: DEFAULT_SCHOOL_COORDS.lng,
    scheduledTime: '08:10 AM',
    morningTime: '08:10 AM',
    eveningTime: '02:00 PM',
    villageName: 'Sultanpur Chilkana',
    studentCount: 0,
    notes: 'स्कूल मुख्य गेट (अंतिम गंतव्य)',
  },
];

export const DEFAULT_ROUTE_2_STOPPAGES = [
  {
    id: 'stop-r2-01',
    name: 'दुमझेड़ा (Dumjhera)',
    sequence: 1,
    lat: 30.0910,
    lng: 77.4320,
    scheduledTime: '07:20 AM',
    morningTime: '07:20 AM',
    eveningTime: '02:20 PM',
    villageName: 'Dumjhera',
    studentCount: 5,
    notes: 'दुमझेड़ा मेन रोड',
  },
  {
    id: 'stop-r2-02',
    name: 'पटनी (Patni)',
    sequence: 2,
    lat: 30.0810,
    lng: 77.4250,
    scheduledTime: '07:32 AM',
    morningTime: '07:32 AM',
    eveningTime: '02:35 PM',
    villageName: 'Patni',
    studentCount: 3,
    notes: 'पटनी तिराहा',
  },
  {
    id: 'stop-r2-03',
    name: 'चौरा खुर्द (Chaura Khurd)',
    sequence: 3,
    lat: 30.0720,
    lng: 77.4210,
    scheduledTime: '07:45 AM',
    morningTime: '07:45 AM',
    eveningTime: '02:45 PM',
    villageName: 'Chaura khurd',
    studentCount: 4,
    notes: 'हुसैनपुर / चौरा मोड़',
  },
  {
    id: 'stop-r2-04',
    name: 'नयाबांस (Nayabans)',
    sequence: 4,
    lat: 30.0640,
    lng: 77.4200,
    scheduledTime: '07:55 AM',
    morningTime: '07:55 AM',
    eveningTime: '02:55 PM',
    villageName: 'Nayabans',
    studentCount: 4,
    notes: 'नयाबांस मुख्य बस स्टॉप',
  },
  {
    id: 'stop-r2-05',
    name: 'ई.वी.एस. पब्लिक स्कूल (E.V.S. Campus)',
    sequence: 5,
    lat: DEFAULT_SCHOOL_COORDS.lat,
    lng: DEFAULT_SCHOOL_COORDS.lng,
    scheduledTime: '08:10 AM',
    morningTime: '08:10 AM',
    eveningTime: '02:00 PM',
    villageName: 'Sultanpur Chilkana',
    studentCount: 0,
    notes: 'स्कूल मुख्य गेट (अंतिम गंतव्य)',
  },
];

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
