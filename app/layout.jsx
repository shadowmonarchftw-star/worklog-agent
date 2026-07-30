import "./globals.css";

export const metadata = {
  title: "AI Worklog Agent",
  description: "Turn GitHub activity into daily developer work logs.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
