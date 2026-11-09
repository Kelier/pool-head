import "./globals.css";
import { cookies } from "next/headers";
import { Shell } from "@/components/Shell";
import { allowsAnonymousRead } from "@/lib/auth/mode";
import { SESSION_COOKIE } from "@/lib/auth/store";

export const metadata = { title: "竞品投放监测" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const guest = allowsAnonymousRead() && !(await cookies()).has(SESSION_COOKIE);
  return (
    <html lang="zh-CN">
      <body>
        <Shell guest={guest}>{children}</Shell>
      </body>
    </html>
  );
}
