import type { Metadata } from "next";
import { Alfa_Slab_One, Permanent_Marker, Karla } from "next/font/google";
import "./globals.css";

const alfaSlabOne = Alfa_Slab_One({ variable: "--font-alfa-slab", subsets: ["latin"], weight: "400" });
const permanentMarker = Permanent_Marker({ variable: "--font-permanent-marker", subsets: ["latin"], weight: "400" });
const karla = Karla({ variable: "--font-karla", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fmly.Club metrics",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${alfaSlabOne.variable} ${permanentMarker.variable} ${karla.variable} antialiased`}>
      <body className="min-h-screen bg-porcelain text-ink">{children}</body>
    </html>
  );
}
