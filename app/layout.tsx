import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "subtubes",
  description: "Your Subtubes account, in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-preference" strategy="beforeInteractive">{`
          try {
            document.documentElement.dataset.theme =
              localStorage.getItem("subtubes-theme") === "light" ? "light" : "dark";
          } catch (error) {
            console.warn("Could not read saved theme preference.", error);
          }
        `}</Script>
        {children}
      </body>
    </html>
  );
}
