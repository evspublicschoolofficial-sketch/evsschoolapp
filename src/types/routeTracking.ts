// Stoppage and Route Tracking Types for EVS Public School Van Tracker

export interface RouteStoppage {
  id: string;
  sequence: number; // 1, 2, 3...
  name: string; // e.g. "रामपुर मनिहारन मोड़"
  lat: number;
  lng: number;
  scheduledTime: string; // e.g. "07:35 AM"
  studentCount: number; // e.g. 5
  landmark?: string; // Optional landmark/notes
  // Dynamic calculation fields computed by ETA engine
  status?: 'passed' | 'approaching' | 'at_stop' | 'upcoming';
  etaMinutes?: number;
  etaFormatted?: string; // "Arriving now", "4m 20s", "14 mins"
  projectedArrival?: string; // "07:38 AM"
  distanceFromVanKm?: number; // Distance from van along path
  straightLineDistanceKm?: number;
}

export interface RouteConfig {
  routeId: string;
  routeName: string;
  schoolOrigin: {
    lat: number;
    lng: number;
    name: string;
    address?: string;
  };
  stoppages: RouteStoppage[];
  averageSpeedKmH: number; // Default transit speed for blending (e.g. 28 km/h)
  dwellTimePerStopSec: number; // Boarding dwell time (e.g. 60 seconds)
}

export interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null; // km/h
  heading: number | null; // degrees 0-360
  accuracy?: number;
  timestamp?: number | string;
}

export interface EtaCalculationResult {
  stoppages: RouteStoppage[];
  activeStoppageIndex: number;
  passedCount: number;
  totalStudents: number;
  totalRemainingDistanceKm: number;
  totalRemainingMinutes: number;
  isStaleSignal: boolean;
  staleSeconds: number;
  effectiveSpeedKmH: number;
}
