import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Outliner',
  description: 'Upload a STEP file, get clean vector line art from any view.',
};

// Set the saved theme before first paint, so a light-mode user never sees a dark flash. Default: dark.
const themeScript = `try{var t=localStorage.getItem('outliner-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
