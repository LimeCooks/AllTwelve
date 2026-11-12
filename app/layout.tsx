import type { Metadata } from 'next';
import './globals.css';
import './workspace-design.css';
import './alltwelve.css';

export const metadata: Metadata = {
  title: 'AllTwelve — Canadian Football Operations',
  description:
    'Film, playbooks, sideline replay, messaging, and team operations in one Canadian football workspace.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
