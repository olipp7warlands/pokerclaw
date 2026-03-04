import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-void text-white flex flex-col overflow-hidden">
      {children}
    </div>
  );
}
