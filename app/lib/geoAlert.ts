'use strict';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const GEO_ALERT_TASK = 'SOUS_CHEF_GEO_ALERT';

const SUPERMARKET_RADIUS_M = 100;
const DWELL_MS = 6 * 60 * 1000; // 6 minutes
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

const KEY_ARRIVAL = 'geo_arrival_at';
const KEY_LAST_SENT = 'geo_last_sent_at';

import { apiFetch } from '@/lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isBoodschappenlijst(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('boodschappen') ||
    n.includes('supermarkt') ||
    n.includes('groceries') ||
    n === 'ah' ||
    n === 'jumbo' ||
    n === 'lidl' ||
    n === 'albert heijn' ||
    n === 'plus' ||
    n === 'aldi'
  );
}

// ── Overpass API ───────────────────────────────────────────────────────────────

async function hasNearbySupermarket(lat: number, lon: number): Promise<boolean> {
  const r = SUPERMARKET_RADIUS_M;
  const query = `[out:json][timeout:10];
node["shop"="supermarket"](around:${r},${lat},${lon});
out count;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const json = await res.json();
    return (json?.elements?.[0]?.tags?.total ?? json?.elements?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Core logic (called from background task + foreground watch) ────────────────

export async function handleLocationUpdate(
  lat: number,
  lon: number,
  userId: string,
): Promise<void> {
  const nearby = await hasNearbySupermarket(lat, lon);

  if (!nearby) {
    await AsyncStorage.removeItem(KEY_ARRIVAL);
    return;
  }

  const now = Date.now();

  // Rate limit: don't alert within cooldown window
  const lastSentRaw = await AsyncStorage.getItem(KEY_LAST_SENT);
  if (lastSentRaw && now - parseInt(lastSentRaw, 10) < COOLDOWN_MS) return;

  // Dwell timer
  const arrivalRaw = await AsyncStorage.getItem(KEY_ARRIVAL);
  if (!arrivalRaw) {
    await AsyncStorage.setItem(KEY_ARRIVAL, String(now));
    return;
  }

  const dwellMs = now - parseInt(arrivalRaw, 10);
  if (dwellMs < DWELL_MS) return;

  // Trigger the alert
  try {
    await apiFetch(`/geo-alert`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    await AsyncStorage.setItem(KEY_LAST_SENT, String(now));
    await AsyncStorage.removeItem(KEY_ARRIVAL);
  } catch {
    // Silent fail — will retry on next location update
  }
}

// ── Background task definition ─────────────────────────────────────────────────
// Must be defined at module level (before any React component renders)

TaskManager.defineTask(GEO_ALERT_TASK, async ({ data, error }: any) => {
  if (error) return;
  const locations: Location.LocationObject[] = data?.locations ?? [];
  if (!locations.length) return;

  const userId = await AsyncStorage.getItem('geo_alert_user_id');
  if (!userId) return;

  const { latitude, longitude } = locations[locations.length - 1].coords;
  await handleLocationUpdate(latitude, longitude, userId);
});

// ── Start / stop ───────────────────────────────────────────────────────────────

export async function startGeoAlertTask(userId: string): Promise<'ok' | 'denied' | 'expo-go'> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return 'denied';

  await AsyncStorage.setItem('geo_alert_user_id', userId);

  // Background location doesn't work in Expo Go — degrade gracefully
  try {
    const bgStatus = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus.status !== 'granted') return 'denied';

    const running = await Location.hasStartedLocationUpdatesAsync(GEO_ALERT_TASK).catch(() => false);
    if (!running) {
      await Location.startLocationUpdatesAsync(GEO_ALERT_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 80,
        deferredUpdatesInterval: 60_000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Sous-Chef',
          notificationBody: 'Supermarktherkenning actief',
          notificationColor: '#FCC10C',
        },
      });
    }
  } catch {
    return 'expo-go';
  }

  return 'ok';
}

export async function stopGeoAlertTask(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(GEO_ALERT_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(GEO_ALERT_TASK);
  await AsyncStorage.multiRemove([KEY_ARRIVAL, 'geo_alert_user_id']);
}

export async function isGeoAlertEnabled(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(GEO_ALERT_TASK).catch(() => false);
}
