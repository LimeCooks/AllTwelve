import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChalkTalk — Canadian Football Operations',
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
