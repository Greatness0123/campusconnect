import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// NOTE: everything in this file runs ONLY on the server (Node runtime).
// None of these constants are ever shipped to the browser bundle, so they
// cannot be read from devtools / page source / the JS network tab.

// SHA-256 of the admin passphrase (pre-hashed so the literal passphrase
// never appears in any source file, server or client).
const PASS_HASH = "e34f92a20532a873cb3184398070b4b82a8fa29cf48572c203dc5f0fa6158231";

// Secret used to sign access tokens (HMAC-SHA256). Server only.
const TOKEN_SECRET = process.env.CCADMIN_TOKEN_SECRET || "campusprints-ccadmin-hmac-salt-v1";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

export const dynamic = "force-dynamic";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sign(payload: string) {
  return createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
}

function safeEqual(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiry)) return false;
  const expected = sign(`ccadmin:${expiry}`);
  if (!safeEqual(signature, expected)) return false;
  return Number(expiry) > Date.now();
}

export async function POST(request: Request) {
  let password: unknown;
  try {
    const body = (await request.json()) as { password?: unknown };
    password = body.password;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if (typeof password !== "string" || password.length === 0 || password.length > 256) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Constant-time style comparison against the pre-computed hash.
  if (!safeEqual(sha256(password), PASS_HASH)) {
    // Small, uniform delay to blunt rapid brute-force attempts.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return NextResponse.json({ ok: false, error: "Incorrect passphrase." }, { status: 401 });
  }

  const expiry = Date.now() + TOKEN_TTL_MS;
  const token = `${expiry}.${sign(`ccadmin:${expiry}`)}`;
  return NextResponse.json({ ok: true, token, expiresAt: expiry });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return NextResponse.json({ valid: verifyToken(token) });
}
