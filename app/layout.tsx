import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  DM_Sans,
  DM_Serif_Display,
  Inter,
  Manrope,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";

// Inter and Space Grotesk drive the interface. The rest only download when a
// font pairing that uses them is selected on the poster.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});
const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Curio Labs | From vague ideas to visual direction",
  description:
    "An AI creative director that turns vague preferences into explicit, editable design decisions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fontVariables = [
    inter,
    spaceGrotesk,
    playfair,
    dmSerif,
    dmSans,
    cormorant,
    manrope,
  ]
    .map((font) => font.variable)
    .join(" ");

  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
