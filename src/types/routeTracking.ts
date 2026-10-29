// Stoppage, Shift, and Route Tracking Types for EVS Public School Van Tracker

export type RouteShift = 'morning' | 'evening';

export interface RouteStoppage {
  id: string;
  sequence: number; // 1, 2, 3...
  name: string; // e.g. "रामपुर मनिहारन मोड़"
  lat: number;
  lng: number;
  scheduledTime: string; // Active shift time (e.g. "07:35 AM" or "02:30 PM")
  morningTime?: string; // Morning pickup time e.g. "07:35 AM"
  eveningTime?: string; // Evening drop time e.g. "02:30 PM"
  studentCount: number; // e.g. 5
  landmark?: string; // Optional landmark/notes
  villageName?: string; // Village name e.g. "Ibrahimpura"
  notes?: string; // Stoppage specific notes
  // Dynamic calculation fields computed by ETA engine
  status?: 'passed' | 'approaching' | 'at_stop' | 'upcoming';
  etaMinutes?: number;
  etaFormatted?: string; // "Arriving now", "4m 20s", "14 mins"
  projectedArrival?: string; // "07:38 AM"
  distanceFromVanKm?: number; // Distance from van along road path
  straightLineDistanceKm?: number;
}

export interface RouteConfig {
  routeId: string; // 'route-1' or 'route-2'
  routeName: string; // e.g. 'रूट #1: रामपुर - चिलकाना मार्ग'
  assignedBusId: string; // e.g. 'ecad7ddc' or '756cedc0'
  assignedDriver: string; // e.g. 'Amjad'
  shift: RouteShift; // 'morning' | 'evening'
  schoolOrigin: {
    lat: number;
    lng: number;
    name: string;
    address?: string;
  };
  stoppages: RouteStoppage[];
  averageSpeedKmH: number; // Default transit speed for blending (e.g. 26 km/h)
  dwellTimePerStopSec: number; // Boarding dwell time (e.g. 60 seconds)
  roadCoordinates?: [number, number][]; // High-precision road-snapped polyline coordinates
  totalRoadDistanceKm?: number;
  estimatedDriveMinutes?: number;
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
  roadPathCoordinates?: [number, number][]; // Actual road polyline
}
