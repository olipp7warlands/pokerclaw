import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface SidebarTab {
  id:      string;
  label:   string;
  content: ReactNode;
}

interface SidebarProps {
  tabs?:     SidebarTab[];
  children?: ReactNode;
}

export function Sidebar({ tabs, children }: SidebarProps) {
  const [open, setOpen]         = useState(true);
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.id ?? "");

  return (
    <div className="relative flex-shrink-0">
      {/* Toggle tab */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute -left-7 top-4 z-10 w-7 h-12 bg-void/80 border border-white/10 rounded-l-lg flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
        title={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        <span className="text-xs">{open ? "›" : "‹"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="flex flex-col h-full bg-void/60 border-l border-white/5 backdrop-blur-sm overflow-hidden"
              style={{ width: 260 }}
            >
              {tabs ? (
                <>
                  {/* Tab bar */}
                  <div className="flex border-b border-white/10 shrink-0">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 py-2 text-[9px] font-mono font-bold uppercase tracking-wide transition-colors truncate px-1
                          ${activeTab === tab.id
                            ? "text-gold border-b-2 border-gold bg-white/[0.03]"
                            : "text-white/30 hover:text-white/60"}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {tabs.find((t) => t.id === activeTab)?.content}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4 p-4 overflow-y-auto">
                  {children}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
