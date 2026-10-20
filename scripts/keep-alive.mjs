#!/usr/bin/env node
/**
 * Standalone Keep-Alive Ping Script
 * Run locally or schedule via cron: node scripts/keep-alive.mjs
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

async function ping() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Initiating keep-alive ping...`);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log("No Supabase URL / Key configured in environment variables. Ping skipped.");
    process.exit(0);
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/keep_alive?select=*`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (res.ok) {
      console.log(`[${timestamp}] Keep-alive ping successful. Status: ${res.status}`);
    } else {
      console.warn(`[${timestamp}] Keep-alive returned status ${res.status}: ${await res.text()}`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Keep-alive ping error:`, error);
  }
}

ping();
