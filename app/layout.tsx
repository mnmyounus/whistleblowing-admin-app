import './globals.css';
import type { Metadata } from 'next';
import { Lora, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

const display = Lora({ variable: '--font-display-raw', subsets: ['latin'], weight: ['600', '700'] });
const body = IBM_Plex_Sans({ variable: '--font-body-raw', subsets: ['latin'], weight: ['400', '500', '600'] });
const code = IBM_Plex_Mono({ variable: '--font-code-raw', subsets: ['latin'], weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'Admin — Anonymous Complaints',
  robots: { index: false, follow: false }, // this app should never appear in search results
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${code.variable}`}>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <div className="mx-auto max-w-4xl px-4 py-10">{children}</div>
      </body>
    </html>
  );
}
