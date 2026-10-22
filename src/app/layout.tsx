import type { Metadata } from "next";
import type { Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://campusprints-ng.zite.so";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Campus Prints | Student Printing Made Simple",
    template: "%s | Campus Prints",
  },
  description: "Upload, preview and configure your campus print order. Get a clear printing estimate in naira before sending documents to print.",
  applicationName: "Campus Prints",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Campus Prints" },
  keywords: ["student printing", "campus printing", "document printing", "print quotation", "Nigeria"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Campus Prints",
    title: "Campus Prints | Student Printing Made Simple",
    description: "Preview your documents, choose print options and see an upfront estimate for campus printing.",
    url: "/",
    images: [{ url: "/icononly.jpg", alt: "Campus Prints logo" }],
  },
  twitter: {
    card: "summary",
    title: "Campus Prints | Student Printing Made Simple",
    description: "Preview your documents and see an upfront campus printing estimate.",
    images: ["/icononly.jpg"],
  },
  icons: {
    icon: [{ url: "/icononly.jpg", type: "image/jpeg" }],
    apple: [{ url: "/pwa-192.png", sizes: "192x192", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafafa",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Campus Prints",
    "description": "On-demand document printing service for university students. Fast PDF and document analysis, transparent Naira quotations, and convenient campus pickup.",
    "url": siteUrl,
    "logo": `${siteUrl}/icononly.jpg`,
    "priceRange": "₦70 - ₦500",
    "currenciesAccepted": "NGN",
    "paymentAccepted": "Cash, Bank Transfer",
    "areaServed": "University Campus",
    "serviceType": [
      "Document Printing",
      "PDF Printing",
      "Black and White Printing",
      "Color Printing",
      "Spiral Binding",
      "Stapling"
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
