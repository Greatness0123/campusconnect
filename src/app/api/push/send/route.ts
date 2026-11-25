import { NextResponse } from "next/server";
import { broadcastPushNotification } from "@/lib/push-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title : "New Print Order";
    const content = typeof body.body === "string" ? body.body : "A new print order has just been placed.";
    const url = typeof body.url === "string" ? body.url : "/ccadmin";
    const tag = typeof body.tag === "string" ? body.tag : "campusconnect-order";

    const result = await broadcastPushNotification({ title, body: content, url, tag });

    return NextResponse.json({
      ok: true,
      delivered: result.successCount,
      failed: result.failureCount,
      total: result.totalSubscribers,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Error sending push notification:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to broadcast notification." },
      { status: 500 }
    );
  }
}
