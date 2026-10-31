import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteStoppage, RouteConfig, GpsPoint } from '../types/routeTracking';
import { fetchRoadSnappingRoute } from '../utils/roadRoutingService';

interface InteractiveRouteMapProps {
  currentGps: GpsPoint;
  routeConfig: RouteConfig;
  stoppages: RouteStoppage[];
  isStaleSignal: boolean;
  staleSeconds: number;
  isPinDropActive: boolean;
  onTogglePinDrop: () => void;
  onMapClickDropPin: (lat: number, lng: number) => void;
  onAddStopAtCurrentGps?: () => void;
  onUpdateStoppageCoords: (stopId: string, lat: number, lng: number) => void;
  onEditStoppage?: (stoppage: RouteStoppage) => void;
  onDeleteStoppage: (stopId: string) => void;
  onUpdateSchoolCoords?: (lat: number, lng: number) => void;
  isSchoolPinMode?: boolean;
  onToggleSchoolPinMode?: () => void;
  focusedStoppage?: RouteStoppage | null;
  driverName?: string;
  driverPhone?: string;
}

export const InteractiveRouteMap: React.FC<InteractiveRouteMapProps> = ({
  currentGps,
  routeConfig,
  stoppages,
  isStaleSignal,
  staleSeconds,
  isPinDropActive,
  onTogglePinDrop,
  onMapClickDropPin,
  onAddStopAtCurrentGps,
  onUpdateStoppageCoords,
  onEditStoppage,
  onDeleteStoppage,
  onUpdateSchoolCoords,
  isSchoolPinMode = false,
  onToggleSchoolPinMode,
  focusedStoppage,
  driverName = 'Amjad',
  driverPhone = '9761081818',
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const vanMarkerRef = useRef<L.Marker | null>(null);
  const schoolMarkerRef = useRef<L.Marker | null>(null);
  const stoppageMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const routeHaloPolylineRef = useRef<L.Polyline | null>(null);
  const tempPinMarkerRef = useRef<L.Marker | null>(null);

  const [followVan, setFollowVan] = useState<boolean>(true);
  const [mapInitialized, setMapInitialized] = useState<boolean>(false);

  // Real road snapping metrics
  const [isRoadSnapped, setIsRoadSnapped] = useState<boolean>(true);
  const [roadDistanceKm, setRoadDistanceKm] = useState<number>(0);
  const [roadDurationMin, setRoadDurationMin] = useState<number>(0);
  const [isRoutingLoading, setIsRoutingLoading] = useState<boolean>(false);

  // Initialize Leaflet Map with robust container cleanup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Prevent "Map container is already initialized" error
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    if ((mapContainerRef.current as any)._leaflet_id) {
      delete (mapContainerRef.current as any)._leaflet_id;
    }

    const initialCenter: [number, number] = [
      currentGps.lat || routeConfig.schoolOrigin.lat,
      currentGps.lng || routeConfig.schoolOrigin.lng,
    ];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 14,
      zoomControl: false,
    });

    // Add free OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstanceRef.current = map;
    setMapInitialized(true);

    // Initial bounding fit between School and Vehicle
    setTimeout(() => {
      map.invalidateSize();
      try {
        const bounds = L.latLngBounds([
          [routeConfig.schoolOrigin.lat, routeConfig.schoolOrigin.lng],
          [currentGps.lat, currentGps.lng],
        ]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } catch {}
    }, 250);

    // Watch for size changes (tab switches, responsive reflow)
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if (mapContainerRef.current && (mapContainerRef.current as any)._leaflet_id) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }
      stoppageMarkersRef.current.clear();
      vanMarkerRef.current = null;
      schoolMarkerRef.current = null;
      routePolylineRef.current = null;
      routeHaloPolylineRef.current = null;
      tempPinMarkerRef.current = null;
    };
  }, []);

  // Handle map clicks for Pin Drop
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;

      // Mode 1: School Pin Repositioning Mode
      if (isSchoolPinMode && onUpdateSchoolCoords) {
        onUpdateSchoolCoords(lat, lng);
        return;
      }

      // Mode 2: Stoppage Pin Drop Mode
      if (!isPinDropActive) return;

      // Drop animated temporary pin
      if (tempPinMarkerRef.current) {
        tempPinMarkerRef.current.remove();
      }

      const tempIcon = L.divIcon({
        className: 'temp-pin-marker',
        html: `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <div style="background: #ef4444; color: white; padding: 6px 12px; border-radius: 9999px; font-weight: 800; font-size: 11px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid white; display: flex; align-items: center; gap: 4px; animation: bounce 1s infinite;">
              <span>📌 नया स्टॉप</span>
            </div>
            <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #ef4444;"></div>
          </div>
        `,
        iconSize: [100, 40],
        iconAnchor: [50, 40],
      });

      const tempMarker = L.marker([lat, lng], { icon: tempIcon }).addTo(map);
      tempPinMarkerRef.current = tempMarker;

      onMapClickDropPin(lat, lng);
    };

    map.on('click', handleMapClick);

    // Change cursor style based on active mode
    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor = (isPinDropActive || isSchoolPinMode) ? 'crosshair' : 'grab';
    }

    return () => {
      map.off('click', handleMapClick);
    };
  }, [isPinDropActive, isSchoolPinMode, onMapClickDropPin, onUpdateSchoolCoords]);

  // Clean up temp pin when pin drop becomes inactive
  useEffect(() => {
    if (!isPinDropActive && tempPinMarkerRef.current) {
      tempPinMarkerRef.current.remove();
      tempPinMarkerRef.current = null;
    }
  }, [isPinDropActive]);

  // Update School Campus Marker (Draggable so manager can place it anywhere precisely)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const schoolCoords: [number, number] = [
      routeConfig.schoolOrigin.lat,
      routeConfig.schoolOrigin.lng,
    ];

    if (!schoolMarkerRef.current) {
      const schoolIcon = L.divIcon({
        className: 'school-campus-marker',
        html: `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: grab;">
            <div style="background: #0c2340; color: #fde047; padding: 6px 10px; border-radius: 12px; font-weight: 900; font-size: 11px; box-shadow: 0 6px 18px rgba(12,35,64,0.4); border: 2.5px solid #fde047; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
              <i class="fa-solid fa-school" style="font-size: 13px;"></i>
              <span>${routeConfig.schoolOrigin.name}</span>
            </div>
            <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid #0c2340;"></div>
          </div>
        `,
        iconSize: [160, 40],
        iconAnchor: [80, 40],
      });

      const marker = L.marker(schoolCoords, { icon: schoolIcon, draggable: true }).addTo(map);

      marker.on('dragend', (e) => {
        const newPos = (e.target as L.Marker).getLatLng();
        if (onUpdateSchoolCoords) {
          onUpdateSchoolCoords(newPos.lat, newPos.lng);
        }
      });

      marker.bindPopup(`
        <div style="padding: 4px; font-family: sans-serif; font-size: 12px; min-width: 200px;">
          <strong style="color: #0c2340; font-size: 13px; display: block; margin-bottom: 2px;">🏫 ${routeConfig.schoolOrigin.name}</strong>
          <span style="color: #64748b; font-size: 11px; display: block;">प्रस्थान एवं वापसी केंद्र (Origin & Hub)</span>
          <span style="color: #0f766e; font-weight: 700; font-size: 11px; display: block; margin-top: 4px;">निर्देशांक: ${routeConfig.schoolOrigin.lat.toFixed(6)}, ${routeConfig.schoolOrigin.lng.toFixed(6)}</span>
          <span style="color: #b45309; font-size: 10px; font-weight: bold; display: block; margin-top: 4px;">💡 इस पिन को खींचकर (Drag करके) सही जगह रख सकते हैं</span>
        </div>
      `);
      schoolMarkerRef.current = marker;
    } else {
      schoolMarkerRef.current.setLatLng(schoolCoords);
    }
  }, [routeConfig.schoolOrigin, onUpdateSchoolCoords, mapInitialized]);

  // Update Live Van Marker with Bearing & Radar Pulse
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // If van is sitting directly at school campus, offset marker slightly so both School & Van icons are clearly visible
    const isAtSchoolExact =
      Math.abs(currentGps.lat - routeConfig.schoolOrigin.lat) < 0.0004 &&
      Math.abs(currentGps.lng - routeConfig.schoolOrigin.lng) < 0.0004;
    const vanCoords: [number, number] = isAtSchoolExact
      ? [currentGps.lat + 0.00028, currentGps.lng + 0.00028]
      : [currentGps.lat, currentGps.lng];
    const heading = currentGps.heading || 0;
    const speed = currentGps.speed !== null ? `${Math.round(currentGps.speed)} km/h` : '0 km/h';

    const vanBgColor = isStaleSignal ? '#dc2626' : '#0c2340';
    const pulseRingColor = isStaleSignal ? 'rgba(220, 38, 38, 0.4)' : 'rgba(245, 158, 11, 0.45)';

    const vanIcon = L.divIcon({
      className: 'live-van-marker',
      html: `
        <div style="position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;">
          <!-- Radar Pulse Wave -->
          <div style="position: absolute; inset: 0; border-radius: 9999px; background: ${pulseRingColor}; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="position: absolute; inset: 6px; border-radius: 9999px; background: ${pulseRingColor}; opacity: 0.7;"></div>

          <!-- Rotating Vehicle Body Container -->
          <div style="position: relative; width: 40px; height: 40px; border-radius: 12px; background: ${vanBgColor}; color: #fde047; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.35); border: 2.5px solid white;">
            <!-- Heading Direction Needle -->
            <div style="position: absolute; top: -6px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 7px solid #fde047; transform: rotate(${heading}deg); transform-origin: 5px 26px;"></div>
            <i class="fa-solid fa-van-shuttle" style="font-size: 16px;"></i>
          </div>

          <!-- Speed Badge -->
          <div style="position: absolute; bottom: -8px; background: #0c2340; color: white; border: 1.5px solid white; border-radius: 9999px; padding: 1px 6px; font-size: 9px; font-weight: 900; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
            ${speed}
          </div>
        </div>
      `,
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });

    if (!vanMarkerRef.current) {
      const marker = L.marker(vanCoords, { icon: vanIcon, zIndexOffset: 1000 }).addTo(map);
      marker.bindPopup(`
        <div style="padding: 4px; font-family: sans-serif; font-size: 12px; min-width: 190px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span style="background: ${isStaleSignal ? '#fee2e2' : '#ecfdf5'}; color: ${isStaleSignal ? '#b91c1c' : '#047857'}; font-weight: 800; font-size: 10px; padding: 2px 6px; border-radius: 4px;">
              ${isStaleSignal ? '⚠️ सिग्नल विलंबित (Stale)' : '● लाइव जीपीएस (Live GPS)'}
            </span>
          </div>
          <strong style="color: #0c2340; font-size: 13px; display: block;">🚐 चालक: ${driverName}</strong>
          <span style="color: #475569; font-size: 11px; display: block;">📞 मोबाइल: ${driverPhone}</span>
          <span style="color: #0284c7; font-weight: 800; font-size: 12px; display: block; margin-top: 4px;">गति: ${speed} • दिशा: ${Math.round(heading)}°</span>
          ${isStaleSignal ? `<span style="color: #dc2626; font-size: 10px; font-weight: 700; display: block; margin-top: 2px;">अंतिम अपडेट: ${staleSeconds} सेकंड पूर्व</span>` : ''}
        </div>
      `);
      vanMarkerRef.current = marker;
    } else {
      vanMarkerRef.current.setLatLng(vanCoords);
      vanMarkerRef.current.setIcon(vanIcon);
    }

    // Auto follow van if enabled
    if (followVan) {
      map.panTo(vanCoords, { animate: true, duration: 0.8 });
    }
  }, [currentGps, isStaleSignal, staleSeconds, driverName, driverPhone, followVan, mapInitialized]);

  // =========================================================================
  // UPDATE REAL ROAD-SNAPPED ROUTE POLYLINE (Follows Actual Streets & Highways)
  // =========================================================================
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let isSubscribed = true;

    const buildRoadPolyline = async () => {
      setIsRoutingLoading(true);

      // Remove existing polylines
      if (routeHaloPolylineRef.current) {
        routeHaloPolylineRef.current.remove();
        routeHaloPolylineRef.current = null;
      }
      if (routePolylineRef.current) {
        routePolylineRef.current.remove();
        routePolylineRef.current = null;
      }

      const sortedStops = [...stoppages].sort((a, b) => a.sequence - b.sequence);

      // CASE 1: When no stoppages are saved yet, draw road from School to Vehicle!
      if (sortedStops.length === 0) {
        const liveWaypoints = [
          { lat: routeConfig.schoolOrigin.lat, lng: routeConfig.schoolOrigin.lng },
          { lat: currentGps.lat, lng: currentGps.lng },
        ];
        const roadResult = await fetchRoadSnappingRoute(liveWaypoints);
        if (!isSubscribed) return;

        setIsRoadSnapped(roadResult.isSnappedToRoad);
        setRoadDistanceKm(roadResult.distanceKm);
        setRoadDurationMin(roadResult.durationMinutes);
        setIsRoutingLoading(false);

        const liveLine = L.polyline(roadResult.roadCoordinates, {
          color: '#10b981', // Emerald-500
          weight: 4,
          opacity: 0.9,
          dashArray: '6, 8',
          lineCap: 'round',
        }).addTo(map);
        routePolylineRef.current = liveLine;
        return;
      }

      // CASE 2: Build sequential road path: School -> Stop 1 -> Stop 2 -> ... -> Stop N -> School
      const sequentialWaypoints: Array<{ lat: number; lng: number }> = [
        { lat: routeConfig.schoolOrigin.lat, lng: routeConfig.schoolOrigin.lng },
        ...sortedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
        { lat: routeConfig.schoolOrigin.lat, lng: routeConfig.schoolOrigin.lng },
      ];

      const roadResult = await fetchRoadSnappingRoute(sequentialWaypoints);
      if (!isSubscribed) return;

      setIsRoadSnapped(roadResult.isSnappedToRoad);
      setRoadDistanceKm(roadResult.distanceKm);
      setRoadDurationMin(roadResult.durationMinutes);
      setIsRoutingLoading(false);

      // 1. Dark navy outer glow / halo line for high road contrast
      const halo = L.polyline(roadResult.roadCoordinates, {
        color: '#0c2340',
        weight: 9,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      routeHaloPolylineRef.current = halo;

      // 2. Main high-visibility vibrant blue road navigation line
      const line = L.polyline(roadResult.roadCoordinates, {
        color: '#2563eb', // Blue-600
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);
      routePolylineRef.current = line;
    };

    buildRoadPolyline();

    return () => {
      isSubscribed = false;
    };
  }, [stoppages, routeConfig.schoolOrigin, routeConfig.routeId, routeConfig.shift, currentGps.lat, currentGps.lng, mapInitialized]);

  // Update Ordered Stoppage Markers with Dynamic States (Passed, Approaching, At Stop, Upcoming)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentMarkersMap = stoppageMarkersRef.current;
    const activeIds = new Set<string>();

    stoppages.forEach((stop) => {
      activeIds.add(stop.id);

      const isPassed = stop.status === 'passed';
      const isAtStop = stop.status === 'at_stop';
      const isApproaching = stop.status === 'approaching';

      let bgColor = '#0284c7'; // Sky-600 upcoming
      let textColor = '#ffffff';
      let borderColor = '#ffffff';
      let pulseRing = '';
      let badgeLabel = `#${stop.sequence}`;

      if (isPassed) {
        bgColor = '#64748b'; // Slate-500
        badgeLabel = '✓';
      } else if (isAtStop) {
        bgColor = '#059669'; // Emerald-600
        borderColor = '#ffffff';
        pulseRing = `
          <div style="position: absolute; inset: -4px; border-radius: 9999px; background: rgba(16, 185, 129, 0.4); animation: ping 1.8s infinite;"></div>
        `;
      } else if (isApproaching) {
        bgColor = '#f59e0b'; // Amber-500
        textColor = '#0f172a';
        borderColor = '#ffffff';
        pulseRing = `
          <div style="position: absolute; inset: -6px; border-radius: 9999px; background: rgba(245, 158, 11, 0.5); animation: ping 1.4s infinite;"></div>
        `;
      }

      const stopIcon = L.divIcon({
        className: `stop-marker-${stop.id}`,
        html: `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: grab;">
            ${pulseRing}
            <div style="position: relative; width: 34px; height: 34px; border-radius: 9999px; background: ${bgColor}; color: ${textColor}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; box-shadow: 0 4px 14px rgba(0,0,0,0.3); border: 2.5px solid ${borderColor}; z-index: 10;">
              ${badgeLabel}
            </div>
            <!-- Name Label Tag -->
            <div style="background: rgba(12,35,64,0.92); color: white; padding: 2px 7px; border-radius: 6px; font-size: 10px; font-weight: 800; white-space: nowrap; margin-top: 2px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.2); max-width: 140px; overflow: hidden; text-overflow: ellipsis;">
              ${stop.name}
            </div>
          </div>
        `,
        iconSize: [120, 60],
        iconAnchor: [60, 17],
      });

      const popupContent = `
        <div style="padding: 6px; font-family: sans-serif; font-size: 12px; min-width: 200px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span style="background: ${bgColor}; color: ${textColor}; padding: 2px 8px; border-radius: 9999px; font-weight: 900; font-size: 10px;">
              स्टॉप #${stop.sequence} • ${stop.status === 'passed' ? 'पार हो चुका' : stop.status === 'at_stop' ? 'वैन स्टॉप पर है' : stop.status === 'approaching' ? 'पहुँच रही है' : 'आगामी'}
            </span>
          </div>
          <strong style="color: #0c2340; font-size: 14px; display: block; margin-bottom: 2px;">${stop.name}</strong>
          <div style="color: #475569; font-size: 11px; margin-top: 4px;">
            <div>🕒 निर्धारित समय: <strong>${stop.scheduledTime}</strong></div>
            ${stop.morningTime ? `<div>🌅 सुबह पिकअप: <strong>${stop.morningTime}</strong></div>` : ''}
            ${stop.eveningTime ? `<div>🌇 शाम ड्रॉप: <strong>${stop.eveningTime}</strong></div>` : ''}
            <div>⏱️ लाइव ETA: <strong style="color: #b45309;">${stop.etaFormatted || 'गणना हो रही है'}</strong> ${stop.projectedArrival ? `(~${stop.projectedArrival})` : ''}</div>
            <div>👥 छात्र संख्या: <strong>${stop.studentCount} विद्यार्थी</strong></div>
            ${stop.landmark ? `<div>📍 पहचान: <em>${stop.landmark}</em></div>` : ''}
            <div style="margin-top: 3px; font-size: 10px; color: #94a3b8;">निर्देशांक: ${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)} (खींचकर बदलें)</div>
          </div>
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            <button id="edit-btn-${stop.id}" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer;">
              ✏️ संपादित करें (Edit)
            </button>
            <button id="del-btn-${stop.id}" style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer;">
              🗑️ हटाएं
            </button>
          </div>
        </div>
      `;

      let marker = currentMarkersMap.get(stop.id);
      if (!marker) {
        marker = L.marker([stop.lat, stop.lng], {
          icon: stopIcon,
          draggable: true,
        }).addTo(map);

        marker.bindPopup(popupContent);

        // Drag to reposition stoppage
        marker.on('dragend', (e: any) => {
          const newPos = e.target.getLatLng();
          onUpdateStoppageCoords(stop.id, newPos.lat, newPos.lng);
        });

        // Popup buttons listener
        marker.on('popupopen', () => {
          const editBtn = document.getElementById(`edit-btn-${stop.id}`);
          if (editBtn && onEditStoppage) {
            editBtn.onclick = () => {
              onEditStoppage(stop);
            };
          }
          const delBtn = document.getElementById(`del-btn-${stop.id}`);
          if (delBtn) {
            delBtn.onclick = () => {
              onDeleteStoppage(stop.id);
            };
          }
        });

        currentMarkersMap.set(stop.id, marker);
      } else {
        marker.setLatLng([stop.lat, stop.lng]);
        marker.setIcon(stopIcon);
        marker.setPopupContent(popupContent);
        // Re-bind popupopen to capture latest stop data
        marker.off('popupopen');
        marker.on('popupopen', () => {
          const editBtn = document.getElementById(`edit-btn-${stop.id}`);
          if (editBtn && onEditStoppage) {
            editBtn.onclick = () => {
              onEditStoppage(stop);
            };
          }
          const delBtn = document.getElementById(`del-btn-${stop.id}`);
          if (delBtn) {
            delBtn.onclick = () => {
              onDeleteStoppage(stop.id);
            };
          }
        });
      }
    });

    // Remove markers that are no longer in stoppages list
    currentMarkersMap.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMarkersMap.delete(id);
      }
    });
  }, [stoppages, onUpdateStoppageCoords, onEditStoppage, onDeleteStoppage, mapInitialized]);

  // Handle focusing a specific stoppage when clicked from sidebar
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusedStoppage) return;

    map.flyTo([focusedStoppage.lat, focusedStoppage.lng], 16, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    const marker = stoppageMarkersRef.current.get(focusedStoppage.id);
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 1200);
    }
  }, [focusedStoppage]);

  // Fit all route bounds (School origin, all stoppages, and current van position)
  const handleFitRoute = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const allPoints: [number, number][] = [
      [routeConfig.schoolOrigin.lat, routeConfig.schoolOrigin.lng],
      [currentGps.lat, currentGps.lng],
      ...stoppages.map((s) => [s.lat, s.lng] as [number, number]),
    ];

    try {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } catch {}
  }, [routeConfig.schoolOrigin, currentGps, stoppages]);

  return (
    <div className="relative w-full h-[560px] rounded-3xl overflow-hidden border-2 border-slate-200 shadow-md">
      {/* MAP CANVAS */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* STALE / OFFLINE GPS WARNING BANNER (Section 5) */}
      {isStaleSignal && (
        <div className="absolute top-3 left-3 right-3 z-[1000] bg-rose-600/95 text-white p-3 sm:p-3.5 rounded-2xl shadow-xl border border-rose-400 backdrop-blur-md flex items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-white text-rose-600 flex items-center justify-center text-sm font-black shrink-0">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </span>
            <div>
              <div className="font-black text-xs sm:text-sm">
                ⚠️ ऑफ़लाइन / पुराना जीपीएस सिग्नल चेतावनी (Offline / Stale GPS Signal)
              </div>
              <p className="text-[11px] text-rose-100 mt-0.5">
                चालक के फोन से पिछले <strong>{staleSeconds} सेकंड</strong> से कोई नया GPS पैकेट नहीं मिला। इंटरनेट या स्लीप मोड की जांच करें।
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-xl bg-white/20 text-white font-mono font-black text-xs shrink-0 border border-white/30">
            {staleSeconds}s Delayed
          </span>
        </div>
      )}

      {/* TOP CONTROLS OVERLAY: PIN-DROP, CURRENT VEHICLE GPS STOP, & VIEW CONTROLS */}
      <div className={`absolute left-3 right-3 z-[900] flex flex-wrap items-center gap-2 ${isStaleSignal ? 'top-20' : 'top-3'}`}>
        {/* ONE-TAP BUTTON: ADD STOP AT CURRENT VEHICLE GPS */}
        {onAddStopAtCurrentGps && (
          <button
            type="button"
            onClick={onAddStopAtCurrentGps}
            className="px-3.5 py-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white text-xs font-black flex items-center gap-2 shadow-lg cursor-pointer border border-emerald-400 active:scale-95 transition"
            title="वाहन वर्तमान में जहाँ खड़ा है, ठीक उसी स्थान को सड़क पर स्टॉपेज के रूप में जोड़ें"
          >
            <i className="fa-solid fa-location-crosshairs text-amber-300"></i>
            <span>📍 वाहन की लोकेशन पर स्टॉप बनाएं</span>
          </button>
        )}

        {/* PIN DROP BUTTON */}
        <button
          type="button"
          onClick={onTogglePinDrop}
          className={`px-3.5 py-2 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg transition-all cursor-pointer backdrop-blur-md border ${
            isPinDropActive
              ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-300 ring-4 ring-rose-300/40'
              : 'bg-[#0c2340]/90 hover:bg-[#0c2340] text-amber-300 border-blue-900/40'
          }`}
          title="मैप पर किसी भी जगह क्लिक करके नया स्टॉप जोड़ें"
        >
          <i className={`fa-solid ${isPinDropActive ? 'fa-xmark' : 'fa-map-pin'}`}></i>
          <span>{isPinDropActive ? 'पिन मोड रद्द करें' : '📌 मैप पर पिन गिराएं'}</span>
        </button>

        {/* FOLLOW VAN TOGGLE */}
        <button
          type="button"
          onClick={() => setFollowVan(!followVan)}
          className={`px-3 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer backdrop-blur-md border ${
            followVan
              ? 'bg-emerald-600 text-white border-emerald-400'
              : 'bg-white/90 hover:bg-white text-slate-700 border-slate-300'
          }`}
          title="गाड़ी के साथ-साथ मैप को केंद्रित रखें"
        >
          <i className="fa-solid fa-crosshairs text-xs"></i>
          <span>{followVan ? '✓ वैन का पीछा जारी' : 'वैन पर केंद्रित करें'}</span>
        </button>

        {/* FIT ROUTE BUTTON */}
        <button
          type="button"
          onClick={handleFitRoute}
          className="px-3 py-2 rounded-2xl bg-white/90 hover:bg-white text-slate-800 text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer backdrop-blur-md border border-slate-300"
          title="पूरा रूट और सभी स्टॉप एक साथ देखें"
        >
          <i className="fa-solid fa-arrows-to-eye text-blue-900 text-xs"></i>
          <span>पूरा रूट देखें (Fit Route)</span>
        </button>

        {/* REAL ROAD SNAPPING STATUS BADGE */}
        <div className="ml-auto hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[#0c2340]/90 text-white text-[11px] font-bold border border-blue-400/40 backdrop-blur-md shadow-md">
          <i className="fa-solid fa-road text-amber-400"></i>
          <span>{isRoadSnapped ? '🛣️ सड़क पर वास्तविक रूट' : 'सड़क रूट'}</span>
          {roadDistanceKm > 0 && (
            <span className="text-amber-300 font-mono ml-1">
              ({roadDistanceKm} km)
            </span>
          )}
          {isRoutingLoading && (
            <i className="fa-solid fa-spinner fa-spin text-xs text-amber-300 ml-1"></i>
          )}
        </div>
      </div>

      {/* PIN DROP ACTIVE HINT BANNER */}
      {isPinDropActive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[900] bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black px-4 py-2 rounded-2xl shadow-xl border-2 border-white flex items-center gap-2 text-xs animate-bounce">
          <i className="fa-solid fa-hand-pointer text-sm"></i>
          <span>मैप पर जिस जगह स्टॉप जोड़ना है, वहां क्लिक करें!</span>
        </div>
      )}

      {/* EMPTY ROUTE NOTICE (When Stoppages == 0) */}
      {stoppages.length === 0 && !isPinDropActive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[800] bg-[#0c2340]/90 text-white px-4 py-2.5 rounded-2xl shadow-xl border border-amber-400/50 backdrop-blur-md flex items-center gap-3 text-xs max-w-md text-center">
          <span className="w-7 h-7 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-sm shrink-0">
            <i className="fa-solid fa-route"></i>
          </span>
          <div className="text-left">
            <div className="font-extrabold text-amber-300">
              {routeConfig.routeName}: अभी कोई स्टॉपेज दर्ज नहीं है
            </div>
            <p className="text-[11px] text-slate-200 mt-0.5">
              वाहन जहाँ रुकेगा, ऊपर <strong>"📍 वाहन की लोकेशन पर स्टॉप बनाएं"</strong> दबाकर नया स्टॉपेज जोड़ें। नीली लाइन स्वतः सड़क पर बनेगी।
            </p>
          </div>
        </div>
      )}

      {/* MAP LEGEND BADGE (Bottom Left) */}
      <div className="absolute bottom-3 left-3 z-[800] bg-white/95 backdrop-blur-xs p-2.5 rounded-2xl border border-slate-200 shadow-md text-[10px] space-y-1 hidden sm:block">
        <div className="font-extrabold text-slate-800 border-b border-slate-100 pb-1 mb-1 flex items-center justify-between gap-2">
          <span>रूट संकेत (Map Legend)</span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-900 font-mono">
            {routeConfig.shift === 'morning' ? '🌅 सुबह' : '🌇 शाम'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
          <span>पार हो चुका (Passed)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
          <span>पहुँच रही है (Approaching)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
          <span>स्टॉप पर है (At Stop)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
          <span>आगामी (Upcoming)</span>
        </div>
      </div>
    </div>
  );
};
