import './globals.css';
import type { Metadata } from 'next';

// Deliberately NOT using next/font/google here. As of Next.js 16.2.x/
// 16.3.x, Turbopack has an open, currently-unresolved regression where
// its build-time font resolution requests a stale/incorrect URL variant
// from fonts.gstatic.com and gets a 404, which Turbopack then treats as
// a hard build failure rather than a warning — see
// github.com/vercel/next.js/issues/92671. This isn't fixable from inside
// this project; it's a bug in the framework's font-fetching itself.
// globals.css already lists real fallbacks after each --font-*-raw
// variable (ui-serif/Georgia/serif, ui-sans-serif/system-ui/sans-serif,
// ui-monospace/SFMono-Regular/monospace), so simply not defining those
// *-raw variables here means the browser's own system fonts render
// instead — a real, safe fallback, not a broken one. If you want the
// original Lora/IBM Plex look back once Vercel ships a fix for that
// issue, or if you'd rather self-host the .woff2 files directly (avoids
// depending on Google Fonts' servers at build time ever again — more
// robust regardless of whether this specific bug gets fixed), reintroduce
// next/font/google or next/font/local then.

export const metadata: Metadata = {
  title: 'Admin — Anonymous Complaints',
  robots: { index: false, follow: false }, // this app should never appear in search results
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="mx-auto max-w-4xl px-4 py-10">{children}</div>
      </body>
    </html>
  );
}
