import type { Metadata } from 'next';
import { MaintenanceBanner } from '@/components/maintenance-banner';
import { DryRunBanner } from '@/components/dry-run-banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Robobounce v2',
  description: 'Plataforma de bouncing automatico de criptomonedas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <DryRunBanner />
        <MaintenanceBanner />
        {children}
      </body>
    </html>
  );
}
