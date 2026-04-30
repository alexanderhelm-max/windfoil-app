import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wind Foil Conditions',
  description: 'Wind foiling conditions for the Swedish west coast',
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
