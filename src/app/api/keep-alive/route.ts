import { NextResponse } from "next/server";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();

  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json({
      status: "standby",
      message: "Supabase credentials are not configured yet in .env.local. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      timestamp,
    });
  }

  try {
    // Upsert or update heartbeat record in keep_alive table
    const { error } = await supabase
      .from("keep_alive")
      .upsert({ id: 1, service_name: "campus-prints", pinged_at: timestamp, status: "ok" });

    if (error) {
      // Fallback query if table schema is different
      const { data, error: selectErr } = await supabase
        .from("orders")
        .select("id")
        .limit(1);

      if (selectErr) {
        return NextResponse.json(
          { status: "error", error: selectErr.message, timestamp },
          { status: 500 }
        );
      }
      return NextResponse.json({
        status: "alive",
        message: "Supabase ping successful (fallback query).",
        timestamp,
      });
    }

    return NextResponse.json({
      status: "alive",
      message: "Supabase keep-alive heartbeat recorded successfully. Project is active.",
      timestamp,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Keep-alive ping failed";
    return NextResponse.json(
      { status: "error", error: errorMsg, timestamp },
      { status: 500 }
    );
  }
}
