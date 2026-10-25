// Decoupled Dynamic ETA Calculation Engine for EVS Public School Van Tracking
import {
  RouteStoppage,
  RouteConfig,
  GpsPoint,
  EtaCalculationResult,
} from '../types/routeTracking';
import { DEFAULT_SCHOOL_COORDS } from './busTrackingService';

// Clean slate: Stoppages will be dynamically added by manager as auto travels along the route
export const DEFAULT_ROUTE_STOPPAGES: RouteStoppage[] = [];

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  routeId: 'route-1',
  routeName: 'रूट #1: चिलकाना - सुल्तानपुर - रामपुर मार्ग',
  assignedBusId: 'ecad7ddc',
  assignedDriver: 'Amjad (अमजद)',
  shift: 'morning',
  schoolOrigin: {
    lat: DEFAULT_SCHOOL_COORDS.lat,
    lng: DEFAULT_SCHOOL_COORDS.lng,
    name: 'ई.वी.एस. पब्लिक स्कूल (E.V.S. Campus)',
    address: DEFAULT_SCHOOL_COORDS.address,
  },
  stoppages: DEFAULT_ROUTE_STOPPAGES,
  averageSpeedKmH: 26, // Realistic rural/town transit speed including speed bumps
  dwellTimePerStopSec: 60, // 1 minute per stop for student boarding
};

// Earth radius in kilometers
const EARTH_RADIUS_KM = 6371;

// Haversine formula to calculate great-circle distance between two GPS coordinates
export const haversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

// Calculate total path distance along sequential points
export const calculatePathDistanceKm = (
  points: Array<{ lat: number; lng: number }>
): number => {
  if (points.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    dist += haversineDistanceKm(
      points[i].lat,
      points[i].lng,
      points[i + 1].lat,
      points[i + 1].lng
    );
  }
  return dist;
};

// Format duration into human-readable text
export const formatEtaDuration = (totalMinutes: number): string => {
  if (totalMinutes <= 0.5) {
    return 'पहुँच रही है (Arriving now)';
  }
  if (totalMinutes < 1) {
    const seconds = Math.round(totalMinutes * 60);
    return `${seconds} sec`;
  }
  if (totalMinutes < 60) {
    const mins = Math.floor(totalMinutes);
    const secs = Math.round((totalMinutes - mins) * 60);
    if (mins <= 5 && secs > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${mins} min${mins > 1 ? 's' : ''}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return `${hours}h ${mins}m`;
};

// Format projected arrival clock time (e.g. "07:38 AM")
export const formatProjectedTime = (baseTime: Date, additionalMinutes: number): string => {
  const target = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000);
  let hours = target.getHours();
  const minutes = target.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // hour '0' should be '12'
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const hrStr = hours < 10 ? `0${hours}` : `${hours}`;
  return `${hrStr}:${minStr} ${ampm}`;
};

// Check if a GPS coordinate timestamp is stale (> 25 seconds elapsed)
export const checkGpsStaleness = (
  timestamp?: number | string
): { isStale: boolean; staleSeconds: number } => {
  if (!timestamp) {
    return { isStale: false, staleSeconds: 0 };
  }
  let packetTime = 0;
  if (typeof timestamp === 'number') {
    packetTime = timestamp;
  } else {
    const parsed = Date.parse(timestamp);
    packetTime = isNaN(parsed) ? Date.now() : parsed;
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - packetTime) / 1000));
  return {
    isStale: diffSec > 25,
    staleSeconds: diffSec,
  };
};

/**
 * PURE DECOUPLED ETA CALCULATION ENGINE
 * Evaluates the vehicle's position relative to the ordered stoppage path.
 * Dynamically computes status ('passed' | 'approaching' | 'at_stop' | 'upcoming'),
 * path distances, dwell times, and accurate projected clock times.
 */
export const calculateStoppageEtas = (
  currentGps: GpsPoint,
  routeConfig: RouteConfig,
  currentTime: Date = new Date()
): EtaCalculationResult => {
  const rawStoppages = routeConfig.stoppages || [];
  if (rawStoppages.length === 0) {
    return {
      stoppages: [],
      activeStoppageIndex: -1,
      passedCount: 0,
      totalStudents: 0,
      totalRemainingDistanceKm: 0,
      totalRemainingMinutes: 0,
      isStaleSignal: false,
      staleSeconds: 0,
      effectiveSpeedKmH: routeConfig.averageSpeedKmH,
    };
  }

  // 1. Sort stoppages by sequence order
  const sortedStops: RouteStoppage[] = [...rawStoppages].sort(
    (a, b) => a.sequence - b.sequence
  );

  // 2. Compute straight-line distances from current GPS to each stoppage
  const distances = sortedStops.map((stop) =>
    haversineDistanceKm(currentGps.lat, currentGps.lng, stop.lat, stop.lng)
  );

  // 3. Find closest stop & determine route progress index
  // Thresholds:
  // - Within 0.12 km (120 meters): 'at_stop'
  // - Once a stop has been reached or left behind, mark previous stops as 'passed'
  let activeIndex = 0;
  let minDistance = Infinity;

  distances.forEach((dist, i) => {
    if (dist < minDistance) {
      minDistance = dist;
      activeIndex = i;
    }
  });

  // Check if van is currently inside the radius of the closest stop
  const isAtStop = minDistance <= 0.12;

  // 4. Calculate blended effective transit speed
  // If van is stopped (e.g. at red light or stop sign), blend with average transit speed
  // to prevent infinite ETA values.
  const rawSpeed = currentGps.speed !== null && currentGps.speed > 3 ? currentGps.speed : null;
  const effectiveSpeedKmH = rawSpeed
    ? Math.max(12, Math.min(50, rawSpeed * 0.45 + routeConfig.averageSpeedKmH * 0.55))
    : routeConfig.averageSpeedKmH;

  const dwellMinutesPerStop = (routeConfig.dwellTimePerStopSec || 60) / 60;

  // 5. Build cumulative remaining path and estimate ETAs
  let cumulativeDistKm = 0;
  let cumulativeMinutes = 0;
  let passedCount = 0;
  let totalStudents = 0;

  const enrichedStoppages: RouteStoppage[] = sortedStops.map((stop, idx) => {
    totalStudents += stop.studentCount || 0;
    const directDist = distances[idx];

    let status: 'passed' | 'approaching' | 'at_stop' | 'upcoming';

    if (idx < activeIndex) {
      status = 'passed';
      passedCount++;
    } else if (idx === activeIndex) {
      if (isAtStop) {
        status = 'at_stop';
      } else if (directDist <= 1.5) {
        status = 'approaching';
      } else {
        status = 'upcoming';
      }
    } else {
      status = 'upcoming';
    }

    if (status === 'passed') {
      return {
        ...stop,
        status,
        distanceFromVanKm: 0,
        straightLineDistanceKm: Math.round(directDist * 100) / 100,
        etaMinutes: 0,
        etaFormatted: 'गुजर चुका (Passed)',
        projectedArrival: stop.scheduledTime,
      };
    }

    // Distance computation for active and future stops
    let segmentDistance = 0;
    if (idx === activeIndex) {
      segmentDistance = directDist;
      cumulativeDistKm += segmentDistance;
    } else {
      const prevStop = sortedStops[idx - 1];
      segmentDistance = haversineDistanceKm(
        prevStop.lat,
        prevStop.lng,
        stop.lat,
        stop.lng
      );
      cumulativeDistKm += segmentDistance;
    }

    // Transit time for this distance
    const driveMinutes = (segmentDistance / effectiveSpeedKmH) * 60;
    // Add dwell time for intervening stops
    const dwell = idx > activeIndex ? dwellMinutesPerStop : 0;
    cumulativeMinutes += driveMinutes + dwell;

    const roundedMins = Math.max(0.2, Math.round(cumulativeMinutes * 10) / 10);
    const etaFormatted =
      status === 'at_stop'
        ? 'वर्तमान स्टॉप (At Stoppage)'
        : formatEtaDuration(roundedMins);
    const projectedArrival = formatProjectedTime(currentTime, roundedMins);

    return {
      ...stop,
      status,
      distanceFromVanKm: Math.round(cumulativeDistKm * 100) / 100,
      straightLineDistanceKm: Math.round(directDist * 100) / 100,
      etaMinutes: roundedMins,
      etaFormatted,
      projectedArrival,
    };
  });

  const { isStale, staleSeconds } = checkGpsStaleness(currentGps.timestamp);

  return {
    stoppages: enrichedStoppages,
    activeStoppageIndex: activeIndex,
    passedCount,
    totalStudents,
    totalRemainingDistanceKm: Math.round(cumulativeDistKm * 100) / 100,
    totalRemainingMinutes: Math.round(cumulativeMinutes * 10) / 10,
    isStaleSignal: isStale,
    staleSeconds,
    effectiveSpeedKmH: Math.round(effectiveSpeedKmH),
  };
};
