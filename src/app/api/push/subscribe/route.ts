import { NextResponse } from "next/server";
import { savePushSubscription } from "@/lib/push-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const subscription = body.subscription;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return NextResponse.json(
        { ok: false, error: "Invalid subscription payload." },
        { status: 400 }
      );
    }

    const userAgent = request.headers.get("user-agent") || undefined;

    const result = await savePushSubscription({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      userAgent,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Could not save push subscription." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "Subscription saved successfully." });
  } catch (err) {
    console.error("Push subscribe error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
