import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import StaleClientGuard from "@/components/StaleClientGuard";
import { getStoreOrNull } from "@/lib/store-context";

// "Gumroad" direction — Space Grotesk (geometric, neo-brutalist).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

/** Title/description come from the tenant's branding (PRD F-9); the What-Aisle
 *  product name is the fallback for non-tenant hosts (unknown slug, superadmin). */
export async function generateMetadata(): Promise<Metadata> {
  const store = await getStoreOrNull().catch(() => null);
  const name = store?.branding.displayName || store?.name;
  if (!name) {
    return {
      title: "What-Aisle — Find any item in the store",
      description: "AI aisle finder for supermarkets. Type any product, in any language, and see which shelf it's on.",
    };
  }
  const zh = store?.name_zh ? `${store.name_zh} ` : "";
  return {
    title: `${zh}${name} — What-Aisle`,
    description: `Find any item at ${name}: search in any language and see the shelf on the store map.`,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} h-full`}>
      <body className="min-h-full" style={{ fontFamily: 'var(--font-space), -apple-system, system-ui, sans-serif' }}>
        <StaleClientGuard />
        {children}
      </body>
    </html>
  );
}
