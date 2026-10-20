import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://campusprints-ng.zite.so", changeFrequency: "monthly", priority: 1 }];
}