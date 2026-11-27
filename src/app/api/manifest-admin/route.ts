import { NextResponse } from "next/server";

/**
 * Admin-specific PWA manifest.
 * start_url is /ccadmin so installing from the admin page opens to the admin dashboard,
 * not the student landing page.
 */
export async function GET() {
  const manifest = {
    name: "Campus Prints – Admin",
    short_name: "Prints Admin",
    description: "Campus Prints admin dashboardmanage orders and notifications.",
    start_url: "/ccadmin",
    scope: "/",
    display: "standalone",
    background_color: "#0f0f0f",
    theme_color: "#0f0f0f",
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
