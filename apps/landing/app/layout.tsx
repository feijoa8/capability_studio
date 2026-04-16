import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { EnvWarningStrip } from "@/components/EnvWarningStrip";
import { SiteHeader } from "@/components/SiteHeader";
import { getServerUser } from "@/lib/getServerUser";
import { getMissingPublicEnvKeys } from "@/lib/publicEnv";
import { landingBrandAssets } from "@/lib/brandAssets";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ??
  "https://capabilitystudio.feijoa8.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  icons: {
    icon: landingBrandAssets.faviconPlaceholder,
  },
  title: {
    default: "Capability Studio | Feijoa8",
    template: "%s | Capability Studio",
  },
  description:
    "Capability intelligence for people and organisations — job profiles, competencies, development, and team insight in one place.",
  openGraph: {
    title: "Capability Studio",
    description:
      "Align roles, competencies, and development. Built for modern capability teams.",
    type: "website",
    locale: "en_NZ",
    siteName: "Capability Studio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Capability Studio",
    description:
      "Align roles, competencies, and development. Built for modern capability teams.",
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const missing = getMissingPublicEnvKeys();
  const user = await getServerUser();

  return (
    <html lang="en" className={inter.variable}>
      <body>
        <EnvWarningStrip missing={missing} />
        <SiteHeader initialUser={user} />
        {children}
      </body>
    </html>
  );
}
