import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata = { title: "竞品投放监测" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
