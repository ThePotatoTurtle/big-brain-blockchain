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
        {/*
          Apply the user's saved theme (if any, and not expired) before first
          paint to avoid flicker. Falls back to a random pick when no
          preference is stored — mirrors THEMES/THEME_STORAGE_KEY/THEME_TTL_MS
          in src/lib/themes.ts (kept inline since this runs pre-hydration).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=["midnight","plum","forest","rose","steel","indigo","gold","ember","graphite"];var k="bbb-theme";var theme=null;var raw=localStorage.getItem(k);if(raw){var d=JSON.parse(raw);if(d&&d.theme&&d.expires&&Date.now()<d.expires&&t.indexOf(d.theme)!==-1){theme=d.theme;}else{localStorage.removeItem(k);}}if(!theme){theme=t[Math.floor(Math.random()*t.length)];}document.documentElement.setAttribute("data-theme",theme);}catch(e){}})();`,
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
