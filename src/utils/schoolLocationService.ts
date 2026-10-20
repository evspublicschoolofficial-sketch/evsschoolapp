import { DEFAULT_SCHOOL_COORDS } from './busTrackingService';

export interface SchoolLocationConfig {
  lat: number;
  lng: number;
  radiusMeters: number;
  name: string;
  address?: string;
  mapsUrl?: string;
  geofenceEnabled: boolean;
  updated_at?: string;
  updated_by?: string;
}

export interface LiveUserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

const STORAGE_KEY_LOCATION = 'evs_school_geo_coords';
const STORAGE_KEY_PREWARMED_LOC = 'evs_prewarmed_user_coords';

// Default school location configuration (EVS Public School, Saharanpur Road, Chilkana Sultanpur)
export const DEFAULT_CONFIG: SchoolLocationConfig = {
  lat: DEFAULT_SCHOOL_COORDS.lat,
  lng: DEFAULT_SCHOOL_COORDS.lng,
  radiusMeters: 4000,
  name: 'EVS PUBLIC SCHOOL (Chilkana Sultanpur)',
  address: 'Saharanpur road, Chilkana Sultanpur, Chilkana, Uttar Pradesh 247231',
  mapsUrl: 'https://maps.app.goo.gl/TCqvnXrQN2326Lpp6',
  geofenceEnabled: true,
};

// In-memory pre-warmed user location
let cachedUserLocation: LiveUserLocation | null = (() => {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY_PREWARMED_LOC);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
})();

let cachedSchoolLocation: SchoolLocationConfig = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LOCATION);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          radiusMeters: parsed.radiusMeters || DEFAULT_CONFIG.radiusMeters,
        };
      }
    }
  } catch {}
  return DEFAULT_CONFIG;
})();

const locationSubscribers = new Set<(loc: LiveUserLocation) => void>();
let watchId: number | null = null;
let isPrewarmerStarted = false;

/**
 * Calculates distance in meters between two coordinates using Haversine formula
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Get active school location config (synchronous from memory/localStorage)
 */
export function getActiveSchoolLocation(): SchoolLocationConfig {
  return cachedSchoolLocation;
}

/**
 * Fetch latest school location from backend server (/api/school-location)
 */
export async function syncSchoolLocationFromServer(): Promise<SchoolLocationConfig> {
  try {
    const res = await fetch(`/api/school-location?_t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
        const merged: SchoolLocationConfig = {
          lat: data.lat,
          lng: data.lng,
          radiusMeters: typeof data.radiusMeters === 'number' ? data.radiusMeters : 4000,
          name: data.name || DEFAULT_CONFIG.name,
          address: data.address || DEFAULT_CONFIG.address,
          mapsUrl: data.mapsUrl || DEFAULT_CONFIG.mapsUrl,
          geofenceEnabled: data.geofenceEnabled !== false,
          updated_at: data.updated_at,
          updated_by: data.updated_by,
        };
        cachedSchoolLocation = merged;
        try {
          localStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify(merged));
        } catch {}
        return merged;
      }
    }
  } catch (err) {
    console.warn('Could not sync school location from server:', err);
  }
  return cachedSchoolLocation;
}

/**
 * Save updated school location (both locally and to server so all staff devices receive it)
 */
export async function updateSchoolLocation(
  config: Partial<SchoolLocationConfig>,
  updatedBy = 'Manager'
): Promise<SchoolLocationConfig> {
  const merged: SchoolLocationConfig = {
    ...cachedSchoolLocation,
    ...config,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };

  cachedSchoolLocation = merged;
  try {
    localStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify(merged));
  } catch {}

  // Push to server asynchronously
  try {
    await fetch('/api/school-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
  } catch (e) {
    console.warn('Could not push school location to server:', e);
  }

  return merged;
}

/**
 * Pre-warm GPS location as soon as app starts so location is ready before user even clicks scanner
 */
export function initGeolocationPrewarmer(): void {
  if (isPrewarmerStarted) return;
  if (typeof window === 'undefined' || !('geolocation' in navigator)) return;

  isPrewarmerStarted = true;

  const onPos = (pos: GeolocationPosition) => {
    const live: LiveUserLocation = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy || 10),
      timestamp: Date.now(),
    };
    cachedUserLocation = live;
    try {
      sessionStorage.setItem(STORAGE_KEY_PREWARMED_LOC, JSON.stringify(live));
    } catch {}

    locationSubscribers.forEach((cb) => {
      try {
        cb(live);
      } catch {}
    });
  };

  const onErr = (err: any) => {
    // Non-fatal, keep trying in background
    console.log('Background geolocation note:', err?.message || err);
  };

  // 1. Immediate initial check
  navigator.geolocation.getCurrentPosition(onPos, onErr, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 15000,
  });

  // 2. Continuous watch with battery-efficient options
  try {
    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
  } catch {}
}

/**
 * Get current pre-warmed location immediately (zero delay)
 */
export function getPrewarmedLocation(): LiveUserLocation | null {
  return cachedUserLocation;
}

/**
 * Subscribe to live location updates
 */
export function subscribeToLocation(cb: (loc: LiveUserLocation) => void): () => void {
  locationSubscribers.add(cb);
  if (cachedUserLocation) {
    cb(cachedUserLocation);
  }
  return () => {
    locationSubscribers.delete(cb);
  };
}
