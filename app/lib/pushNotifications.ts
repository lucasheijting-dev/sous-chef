import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const PUSH_SYNC_TASK = 'SOUS_CHEF_CALENDAR_SYNC';

// ── Background task ────────────────────────────────────────────────────────────
// Defined at module scope so it's registered before any component mounts.

TaskManager.defineTask(PUSH_SYNC_TASK, async ({ data, error }: any) => {
  if (error) return;

  const notification = data?.notification as Notifications.Notification | undefined;
  const payload = notification?.request?.content?.data as Record<string, any> | undefined;
  if (!payload?.type || payload.type !== 'calendar_event') return;

  try {
    const { title, date, time, calendarStream } = payload as {
      title: string;
      date: string;
      time?: string;
      calendarStream?: string;
    };

    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== 'granted') return;

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

    // Find the best matching calendar:
    // 1. One titled "Sous-Chef" (our app-created calendar)
    // 2. The default calendar
    const sousChefCal = calendars.find(c => c.title === 'Sous-Chef');
    const defaultCal = calendars.find(c => c.allowsModifications && c.source?.isLocalAccount);
    const targetCalId = sousChefCal?.id ?? defaultCal?.id ?? calendars.find(c => c.allowsModifications)?.id;

    if (!targetCalId) return;

    // Build start/end dates
    let startDate: Date;
    let endDate: Date;
    let allDay = false;

    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      if (time) {
        const [h, min] = time.split(':').map(Number);
        startDate = new Date(y, m - 1, d, h, min);
        endDate = new Date(y, m - 1, d, h, min + 60);
      } else {
        startDate = new Date(y, m - 1, d);
        endDate = new Date(y, m - 1, d);
        allDay = true;
      }
    } else {
      return; // no date — can't write to calendar
    }

    await Calendar.createEventAsync(targetCalId, {
      title,
      startDate,
      endDate,
      allDay,
      notes: `Via Sous-Chef (${calendarStream ?? 'personal'})`,
    });
  } catch {
    // silent — background tasks must not throw
  }
});

// ── Registration ───────────────────────────────────────────────────────────────

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Save to Supabase so the backend can find it
    await supabase
      .from('users')
      .update({ push_token: token })
      .eq('id', userId);

    // Register the background task for incoming push notifications
    await Notifications.registerTaskAsync(PUSH_SYNC_TASK);
  } catch {
    // Don't crash if push registration fails
  }
}

// ── Notification handler ───────────────────────────────────────────────────────
// Show nothing visible for calendar_event pushes — they're silent background syncs.

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, any>;
    if (data?.type === 'calendar_event') {
      return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false };
    }
    return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true };
  },
});
