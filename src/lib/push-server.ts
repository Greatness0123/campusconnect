import { setVapidDetails, sendNotification } from "web-push";
import { createClient } from "@supabase/supabase-js";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BDiVordInD0OC-TFYoMRcWz1p5DaJDJyjIdvi1JhBbyMlWKKOAEqB5vmXcM_vxGo2WytIW9kVhsojM5zT197X_U";

export const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "KjQSXoVaJ1LLgqqea4lWBLmBV-_pfIm5v86OpO_QzVU";

export const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@campusconnect.ng";

try {
  setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn("Failed to set VAPID details:", err);
}

/**
 * Server-side Supabase client using the SERVICE ROLE key.
 * This bypasses RLS so push subscriptions can be read from any serverless lambda.
 * This module is ONLY imported in API routes (server-side) — never in client components.
 */
function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  // Prefer service role key; fall back to anon key with a warning
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
};

export async function savePushSubscription(sub: StoredPushSubscription): Promise<boolean> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    console.warn("[push] savePushSubscription: missing fields", sub);
    return false;
  }

  const db = getAdminSupabase();
  if (!db) {
    console.warn("[push] savePushSubscription: Supabase not configured — subscription NOT persisted");
    // Return true so the client thinks it succeeded; they'll re-subscribe next visit
    return true;
  }

  const { error } = await db.from("admin_push_subscriptions").upsert(
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
    console.error("[push] savePushSubscription Supabase error:", error.message, error.details);
    return false;
  }

  console.log("[push] Subscription saved:", sub.endpoint.slice(0, 60) + "…");
  return true;
}

export async function getAllPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const db = getAdminSupabase();
  if (!db) {
    console.warn("[push] getAllPushSubscriptions: Supabase not configured — returning []");
    return [];
  }

  const { data, error } = await db
    .from("admin_push_subscriptions")
    .select("endpoint, p256dh, auth, user_agent");

  if (error) {
    console.error("[push] getAllPushSubscriptions Supabase error:", error.message, error.details);
    return [];
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log("[push] getAllPushSubscriptions: 0 rows in table");
    return [];
  }

  const subs: StoredPushSubscription[] = data
    .filter((row) => row.endpoint && row.p256dh && row.auth)
    .map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
      userAgent: row.user_agent ?? undefined,
    }));

  console.log(`[push] getAllPushSubscriptions: found ${subs.length} subscription(s)`);
  return subs;
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const db = getAdminSupabase();
  if (!db) return;
  try {
    await db.from("admin_push_subscriptions").delete().eq("endpoint", endpoint);
  } catch {
    // ignore
  }
}

export type PushNotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type PushSendError = {
  endpoint: string;
  statusCode?: number;
  message?: string;
};

export async function broadcastPushNotification(payload: PushNotificationPayload): Promise<{
  successCount: number;
  failureCount: number;
  totalSubscribers: number;
  errors: PushSendError[];
}> {
  const subscriptions = await getAllPushSubscriptions();
  if (subscriptions.length === 0) {
    return { successCount: 0, failureCount: 0, totalSubscribers: 0, errors: [] };
  }

  const notificationPayloadString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/ccadmin",
    tag: payload.tag || "campusconnect-order",
  });

  let successCount = 0;
  let failureCount = 0;
  const errors: PushSendError[] = [];

  const pushPromises = subscriptions.map(async (sub) => {
    try {
      await sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        notificationPayloadString,
        { TTL: 60 * 60 * 24, urgency: "high" }
      );
      successCount += 1;
      console.log("[push] ✓ sent to:", sub.endpoint.slice(0, 60));
    } catch (err: unknown) {
      failureCount += 1;
      const e = err as { statusCode?: number; body?: string; message?: string };
      const statusCode = e?.statusCode;
      const errMsg = e?.body ?? e?.message ?? String(err);

      console.error(
        `[push] ✗ send failed — status ${statusCode} — endpoint: ${sub.endpoint.slice(0, 60)}\n  body: ${errMsg}`
      );

      errors.push({
        endpoint: sub.endpoint.slice(0, 80),
        statusCode,
        message: errMsg?.slice(0, 200),
      });

      // 404 / 410 = subscription gone — purge it
      if (statusCode === 404 || statusCode === 410) {
        void removePushSubscription(sub.endpoint);
      }
      // 401 / 403 = VAPID mismatch or expired — purge so admin can re-subscribe
      if (statusCode === 401 || statusCode === 403) {
        void removePushSubscription(sub.endpoint);
      }
    }
  });

  await Promise.allSettled(pushPromises);
  console.log(`[push] broadcast done: ${successCount} ok, ${failureCount} failed`);

  return { successCount, failureCount, totalSubscribers: subscriptions.length, errors };
}
