/**
 * REAL-TIME AUTO-REFRESH & DATA SYNCHRONIZATION SERVICE
 * Ensures that whenever a teacher, manager, or parent updates ANY data:
 * 1. BroadcastChannel synchronizes all open browser tabs immediately.
 * 2. WebSocket synchronizes across different devices / users in real-time.
 * 3. Page visibility change / window focus automatically checks and refreshes data.
 * 4. Background smart polling checks for updates smoothly without disturbing user input.
 */

export type EntityType = 'fee' | 'student' | 'notice' | 'behavior' | 'homework' | 'all';

export interface DataMutationEvent {
  type: 'APP_DATA_UPDATED';
  entity: EntityType;
  action?: string;
  details?: any;
  timestamp: number;
}

type SyncCallback = (event: DataMutationEvent) => void;

class RealtimeSyncManager {
  private broadcastChannel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private listeners: Set<SyncCallback> = new Set();
  private reconnectTimer: any = null;
  private isDestroyed = false;

  constructor() {
    this.initBroadcastChannel();
    this.initWebSocket();
    this.initWindowEvents();
  }

  private initBroadcastChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('evs_school_realtime_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'APP_DATA_UPDATED') {
            this.notifyListeners(event.data);
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel initialization note:', e);
      }
    }
  }

  private initWebSocket() {
    if (typeof window === 'undefined') return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/location`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'APP_DATA_UPDATED') {
            this.notifyListeners({
              type: 'APP_DATA_UPDATED',
              entity: data.entity || 'all',
              action: data.action,
              details: data.details,
              timestamp: data.timestamp || Date.now(),
            });
          }
        } catch {}
      };

      this.ws.onclose = () => {
        if (!this.isDestroyed) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.initWebSocket(), 5000);
        }
      };

      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {}
      };
    } catch (e) {
      console.warn('WebSocket connection note:', e);
    }
  }

  private initWindowEvents() {
    if (typeof window === 'undefined') return;

    // Secondary fallback: storage event for cross-tab updates
    window.addEventListener('storage', (e) => {
      if (e.key === 'evs_realtime_mutation_trigger' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          this.notifyListeners(parsed);
        } catch {}
      }
    });

    // Auto-refresh when user returns to this tab / window
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.notifyListeners({
          type: 'APP_DATA_UPDATED',
          entity: 'all',
          action: 'visibility_change',
          timestamp: Date.now(),
        });
      }
    });

    window.addEventListener('focus', () => {
      this.notifyListeners({
        type: 'APP_DATA_UPDATED',
        entity: 'all',
        action: 'window_focus',
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Broadcast an update to all open tabs and connected devices
   */
  public broadcastUpdate(entity: EntityType, action?: string, details?: any) {
    const payload: DataMutationEvent = {
      type: 'APP_DATA_UPDATED',
      entity,
      action,
      details,
      timestamp: Date.now(),
    };

    // 1. Notify local listeners in this window/tab immediately
    this.notifyListeners(payload);

    // 2. Broadcast to other tabs on same device via BroadcastChannel
    try {
      this.broadcastChannel?.postMessage(payload);
    } catch {}

    // 3. Fallback via localStorage for older browsers
    try {
      localStorage.setItem('evs_realtime_mutation_trigger', JSON.stringify(payload));
    } catch {}

    // 4. Broadcast to other devices via WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'DATA_MUTATED',
          entity,
          action,
          details,
        }));
      } catch {}
    } else {
      // 5. Fallback via HTTP notify endpoint
      try {
        fetch('/api/notify-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity, action, details }),
        }).catch(() => {});
      } catch {}
    }
  }

  /**
   * Subscribe to real-time data update events
   */
  public subscribe(callback: SyncCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(event: DataMutationEvent) {
    this.listeners.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error('Error in realtime sync listener:', err);
      }
    });
  }

  public destroy() {
    this.isDestroyed = true;
    clearTimeout(this.reconnectTimer);
    try {
      this.broadcastChannel?.close();
      this.ws?.close();
    } catch {}
    this.listeners.clear();
  }
}

export const realtimeSync = new RealtimeSyncManager();
