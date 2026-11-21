import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Outliner',
  description: 'Upload a STEP file, get clean vector line art from any view.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
