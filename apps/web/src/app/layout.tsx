import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "记忆助手 · Personal Agent",
  description: "Personal Agent 记忆工作台 · 前端演示",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
