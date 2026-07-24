import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MeetSweet API",
  description: "MeetSweet backend API server — diagnostic dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; padding: 0; }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
