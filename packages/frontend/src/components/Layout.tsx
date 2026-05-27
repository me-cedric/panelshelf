import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { Outlet, NavLink } from "react-router-dom";
import {
  Library,
  Download,
  Settings,
  Search,
  Wind,
  ArrowUpToLine,
  CheckCircle2,
  Play,
} from "lucide-react";
import {
  isOnboardingDone,
  resetOnboarding,
} from "../utils/onboarding-storage.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";

const navItems = [
  { to: "/", icon: Search, label: "Catalog", end: true },
  { to: "/library", icon: Library, label: "Library" },
  { to: "/downloads", icon: Download, label: "Downloads" },
  { to: "/sources", icon: Settings, label: "Sources" },
];

export default function Layout() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(() =>
    isOnboardingDone()
  );
  const [showReRunConfirm, setShowReRunConfirm] = useState(false);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const handleReRun = useCallback(() => {
    setShowReRunConfirm(true);
  }, []);

  const confirmReRun = useCallback(() => {
    setShowReRunConfirm(false);
    resetOnboarding();
    window.location.reload();
  }, []);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900/50 border-r border-gray-800 flex flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-panel-600 flex items-center justify-center">
            <Wind className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">PanelShelf</h1>
            <p className="text-xs text-gray-500">Comic Manager</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-panel-600/10 text-panel-400 border border-panel-600/20"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800">
          {/* Onboarding status */}
          <div className="flex items-center justify-between mb-2">
            {onboardingDone ? (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs text-gray-500">Setup complete</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-xs text-gray-500">Setup incomplete</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleReRun}
              className="flex items-center gap-1 text-xs text-panel-500 hover:text-panel-400 transition-colors"
            >
              {onboardingDone ? "Re-run" : (
                <><Play className="w-3 h-3" /> Open</>
              )}
            </button>
          </div>
          <p className="text-xs text-gray-600">PanelShelf v0.1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="flex-1 overflow-y-auto bg-gray-950">
        <div className="p-6 max-w-7xl mx-auto">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-panel-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Scroll-to-top button */}
      <ConfirmDialog
        open={showReRunConfirm}
        onClose={() => setShowReRunConfirm(false)}
        onConfirm={confirmReRun}
        title={onboardingDone ? "Re-run onboarding?" : "Open setup?"}
        message={onboardingDone
          ? "This will reset your setup progress and reload the page. Your sources and library data won't be affected."
          : "This will open the setup process again. Your current sources and library data won't be affected."
        }
      />

      <button
        onClick={scrollToTop}
        className={`fixed bottom-6 right-6 z-40 p-3 rounded-full bg-panel-600/90 text-white shadow-lg shadow-panel-900/30 hover:bg-panel-500 transition-all duration-300 ${
          showScrollTop
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}
        title="Scroll to top"
      >
        <ArrowUpToLine className="w-5 h-5" />
      </button>
    </div>
  );
}
