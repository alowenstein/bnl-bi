import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Template Filler",
  description: "Upload an Excel file and generate personalized emails from a template",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
