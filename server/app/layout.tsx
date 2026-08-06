import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MeetSweet — Connect. Create. Captivate.",
  description:
    "MeetSweet is a creator platform where you can share exclusive content, connect with fans, and build your community.",
  openGraph: {
    title: "MeetSweet",
    description: "Connect. Create. Captivate.",
    siteName: "MeetSweet",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MeetSweet",
    description: "Connect. Create. Captivate.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          html { scroll-behavior: smooth; }
          body {
            margin: 0;
            padding: 0;
            background: #0C0C0F;
            color: #ffffff;
            font-family: 'Poppins', ui-sans-serif, system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          * { -webkit-tap-highlight-color: transparent; }
          a { color: inherit; text-decoration: none; }
          button { font-family: inherit; cursor: pointer; }
          a:focus, button:focus { outline: none; }
          a:focus-visible, button:focus-visible {
            outline: 2px solid rgba(255,255,255,0.9);
            outline-offset: 3px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
