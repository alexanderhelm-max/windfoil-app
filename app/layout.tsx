import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Swedish Wind Foil Opportunities',
  description: 'Live wind & forecast for windfoiling on the Swedish west coast',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-900 text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
