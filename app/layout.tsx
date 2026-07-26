import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '러닝 대시보드',
  description: '가민 커넥트 러닝 데이터 대시보드',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#10151F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
