import { setVapidDetails, sendNotification } from "web-push";
import { supabase, isSupabaseConfigured } from "./supabase";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BGj2QZfzbGVhcc3UT4uz21Jk9UaNMQL7awcl2AYM4sMg1jv-xDYrfqKZKD-PsEyLgj9TJwUd8I7xl2sMLBGm9YI";

export const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "nPs68733cZuJlozi8h5KAEqooh2uahTMHw9phtP9-TM";

export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@campusconnect.ng";

try {
  setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn("Failed to set VAPID details:", err);
}

export type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
};

// In-memory fallback in case Supabase is offline or table has not yet been migrated
const memorySubscriptions = new Map<string, StoredPushSubscription>();

export async function savePushSubscription(sub: StoredPushSubscription): Promise<boolean> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return false;
  }

  memorySubscriptions.set(sub.endpoint, sub);

  if (supabase && isSupabaseConfigured) {
    try {
      const { error } = await supabase.from("admin_push_subscriptions").upsert(
        {
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          user_agent: sub.userAgent || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );
      if (error) {
        console.warn("Supabase push subscription upsert notice:", error.message);
      }
    } catch (err) {
      console.warn("Error saving push subscription to Supabase:", err);
    }
  }

  return true;
}

export async function getAllPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const combined = new Map<string, StoredPushSubscription>();

  // Add memory subs first
  for (const [endpoint, sub] of memorySubscriptions.entries()) {
    combined.set(endpoint, sub);
  }

  // Fetch from Supabase if configured
  if (supabase && isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("admin_push_subscriptions")
        .select("endpoint, p256dh, auth, user_agent");

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          if (row.endpoint && row.p256dh && row.auth) {
            combined.set(row.endpoint, {
              endpoint: row.endpoint,
              keys: {
                p256dh: row.p256dh,
                auth: row.auth,
              },
              userAgent: row.user_agent ?? undefined,
            });
          }
        }
      }
    } catch (err) {
      console.warn("Error reading push subscriptions from Supabase:", err);
    }
  }

  return Array.from(combined.values());
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  memorySubscriptions.delete(endpoint);

  if (supabase && isSupabaseConfigured) {
    try {
      await supabase.from("admin_push_subscriptions").delete().eq("endpoint", endpoint);
    } catch {
      // ignore
    }
  }
}

export type PushNotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function broadcastPushNotification(payload: PushNotificationPayload): Promise<{
  successCount: number;
  failureCount: number;
  totalSubscribers: number;
}> {
  const subscriptions = await getAllPushSubscriptions();
  if (subscriptions.length === 0) {
    return { successCount: 0, failureCount: 0, totalSubscribers: 0 };
  }

  const notificationPayloadString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/ccadmin",
    tag: payload.tag || "campusconnect-order",
  });

  let successCount = 0;
  let failureCount = 0;

  const pushPromises = subscriptions.map(async (sub) => {
    try {
      await sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        notificationPayloadString,
        {
          TTL: 60 * 60 * 24, // 24 hours
          urgency: "high",
        }
      );
      successCount += 1;
    } catch (err: unknown) {
      failureCount += 1;
      const statusCode = (err as { statusCode?: number })?.statusCode;
      // 404 or 410 means device unregistered or subscription expired
      if (statusCode === 404 || statusCode === 410) {
        void removePushSubscription(sub.endpoint);
      } else {
        console.warn("Web Push send failure:", err);
      }
    }
  });

  await Promise.allSettled(pushPromises);

  return {
    successCount,
    failureCount,
    totalSubscribers: subscriptions.length,
  };
}
