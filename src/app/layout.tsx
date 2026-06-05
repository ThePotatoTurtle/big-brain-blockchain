import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navigation from "@/components/Navigation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Big Brain Blockchain 3.0",
  description: "5Brain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pick a random color scheme before first paint to avoid flicker. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=["midnight","plum","forest","rose","steel","indigo","gold","ember","graphite"];document.documentElement.setAttribute("data-theme",t[Math.floor(Math.random()*t.length)]);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <Navigation />
        <main className="pt-10 md:pt-0 pb-20 md:pb-6">{children}</main>
      </body>
    </html>
  );
}
