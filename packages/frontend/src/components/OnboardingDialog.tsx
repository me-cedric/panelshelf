import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProviders,
  toggleProvider,
} from "../api/client.ts";
import { createLibrarySource, scanLibrarySource } from "../api/library.ts";
import { useToast } from "./Toast.tsx";
import { Wind, RefreshCw, CheckCircle2, ChevronRight, Library, Database } from "lucide-react";
import { PROVIDER_ICONS, PROVIDER_DESCRIPTIONS } from "../constants/providers.ts";
import {
  isOnboardingDone,
  setOnboardingDone,
  clearOnboardingStorage,
  getSavedStep,
  saveStep,
  getSavedEnabledIds,
  saveEnabledIds,
  hasSavedState,
} from "../utils/onboarding-storage.ts";

export default function OnboardingDialog() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [step, setStep] = useState<1 | 2>(getSavedStep);
  const [dismissed, setDismissed] = useState(false);

  // Fetch providers to show toggle options (shared key with Sources page)
  const { data: providersData, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => fetchProviders().then((r) => r.providers),
    staleTime: 60_000,
  });

  const configurableProviders = (providersData || []).filter(
    (p: any) => p.configurable
  );

  // Track which providers the user wants enabled (default: all off, restored from localStorage)
  const [enabledIds, setEnabledIds] = useState<Set<string>>(getSavedEnabledIds);

  const toggleEnabled = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Step 2: optional library folder
  const [folderPath, setFolderPath] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyPhase, setApplyPhase] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect if this mount restored saved state, and notify the user
  const restoredFromSaved = useMemo(hasSavedState, []);

  // Show a one-time toast on mount if restored from saved state
  useEffect(() => {
    if (!restoredFromSaved) return;

    const parts: string[] = [];
    if (step === 2) parts.push("step 2 — Library Folder");
    if (enabledIds.size > 0) {
      parts.push(`${enabledIds.size} provider(s) selected`);
    }

    addToast({
      message: "Resuming setup",
      description: parts.length > 0
        ? `Picked up where you left off: ${parts.join(", ")}.`
        : "Picked up where you left off.",
      type: "info",
    });
    // Only fire on mount — no deps needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current step and provider selections to localStorage so re-runs pick up where they left off
  useEffect(() => {
    saveStep(step);
  }, [step]);

  useEffect(() => {
    saveEnabledIds(enabledIds);
  }, [enabledIds]);

  const completeOnboarding = useCallback(() => {
    setOnboardingDone();
    clearOnboardingStorage();
    setDismissed(true);
  }, []);

  const handleApply = useCallback(async () => {
    if (applying) return;
    setApplying(true);

    try {
      // Step A: Enable selected providers
      const configurable = configurableProviders.filter((p: any) => p.configurable);
      const toEnable = configurable.filter((p: any) => enabledIds.has(p.id));
      const toDisable = configurable.filter(
        (p: any) => !enabledIds.has(p.id) && p.enabled
      );

      const togglePromises: Promise<any>[] = [];

      for (const p of toEnable) {
        if (!p.enabled) {
          togglePromises.push(toggleProvider(p.id));
        }
      }
      for (const p of toDisable) {
        if (p.enabled) {
          togglePromises.push(toggleProvider(p.id));
        }
      }

      if (togglePromises.length > 0) {
        setApplyPhase("Applying provider settings...");
        await Promise.all(togglePromises);
        queryClient.invalidateQueries({ queryKey: ["providers"] });
        queryClient.invalidateQueries({ queryKey: ["sources"] });
      }

      // Step B: Optionally create a library source
      if (folderPath.trim()) {
        setApplyPhase("Adding library folder...");
        try {
          const { source } = await createLibrarySource({
            path: folderPath.trim(),
            scanRecursive: true,
          });

          if (source?.id) {
            setApplyPhase("Scanning folder for comics...");
            await scanLibrarySource(source.id);
          }
          queryClient.invalidateQueries({ queryKey: ["library-sources"] });
          queryClient.invalidateQueries({ queryKey: ["library-items"] });
          queryClient.invalidateQueries({ queryKey: ["library-stats"] });
        } catch (err: any) {
          addToast({
            message: "Could not add library folder",
            description: err.message,
            type: "warning",
          });
        }
      }

      addToast({
        message: "Welcome to PanelShelf!",
        description: toEnable.length > 0
          ? `${toEnable.length} provider(s) enabled. You can change these anytime in Sources.`
          : "You can configure providers and folders anytime from the sidebar.",
        type: "success",
      });

      completeOnboarding();
    } catch (err: any) {
      addToast({
        message: "Something went wrong",
        description: err.message,
        type: "error",
      });
    } finally {
      setApplying(false);
      setApplyPhase(null);
    }
  }, [configurableProviders, enabledIds, folderPath, queryClient, addToast, completeOnboarding]);

  // If dismissed or onboarding already done, don't render
  if (dismissed || isOnboardingDone()) return null;

  // Basic path validation helper
  const validateFolderPath = (path: string): string | null => {
    const trimmed = path.trim();
    if (!trimmed) return null; // empty is ok — it's optional
    if (/^https?:\/\//i.test(trimmed)) return "Enter a local folder path, not a URL.";
    if (/[<>"|?*\x00-\x1f]/.test(trimmed)) return "Path contains invalid characters.";
    return null;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="card relative w-full max-w-lg mx-4 p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Wind className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Welcome to PanelShelf
              </h2>
              <p className="text-sm text-gray-400">
                Your comic collection manager
              </p>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 pt-4 pb-2">
          <div
            className={`flex items-center gap-1.5 text-xs font-medium ${
              step === 1 ? "text-panel-400" : "text-emerald-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === 1
                  ? "bg-panel-500/20 text-panel-400 border border-panel-500/30"
                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              }`}
            >
              {step === 1 ? "1" : <CheckCircle2 className="w-3 h-3" />}
            </span>
            Providers
          </div>
          <div className="flex-1 h-px bg-gray-800 mx-1" />
          <div
            className={`flex items-center gap-1.5 text-xs font-medium ${
              step === 2 ? "text-panel-400" : "text-gray-500"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === 2
                  ? "bg-panel-500/20 text-panel-400 border border-panel-500/30"
                  : "bg-gray-800 text-gray-600 border border-gray-700"
              }`}
            >
              2
            </span>
            Library Folder
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 leading-relaxed">
                PanelShelf can fetch comics from online sources. Enable the
                providers you'd like to use — you can change these anytime.
              </p>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
                  <span className="ml-2 text-sm text-gray-500">
                    Loading providers...
                  </span>
                </div>
              ) : configurableProviders.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-4">
                  No configurable providers found on the server.
                </p>
              ) : (
                <div className="space-y-2">
                  {configurableProviders.map((provider: any) => {
                    const Icon = PROVIDER_ICONS[provider.id] || Database;
                    const isOn = enabledIds.has(provider.id);
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => toggleEnabled(provider.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
                          isOn
                            ? "border-panel-500/40 bg-panel-500/10"
                            : "border-gray-800 hover:border-gray-700 bg-gray-900/50 hover:bg-gray-800/50"
                        }`}
                      >
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            isOn
                              ? "bg-panel-600/20 text-panel-300"
                              : "bg-gray-800 text-gray-500"
                          }`}
                        >
                          <Icon className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              isOn ? "text-white" : "text-gray-400"
                            }`}
                          >
                            {provider.name}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed line-clamp-2">
                            {PROVIDER_DESCRIPTIONS[provider.id] ||
                              "Built-in content provider."}
                          </p>
                        </div>
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                            isOn
                              ? "bg-panel-500 border-panel-500"
                              : "border-gray-600 bg-transparent"
                          }`}
                        >
                          {isOn && (
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-gray-600">
                Don't worry — you can enable or disable providers later from
                the Sources page in the sidebar.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 leading-relaxed">
                If you have a folder with comic files (CBZ, CBR, PDF) on your
                computer, add it here to build your local library. This is
                optional — you can add folders anytime.
              </p>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Comics folder path{" "}
                  <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  ref={inputRef}
                  className={`input w-full ${folderError ? "border-red-500/60" : ""}`}
                  placeholder="/path/to/your/comics"
                  value={folderPath}
                  onChange={(e) => {
                    setFolderPath(e.target.value);
                    if (folderError) setFolderError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && folderPath.trim() && !applying) {
                      const err = validateFolderPath(folderPath);
                      if (err) { setFolderError(err); return; }
                      setApplyPhase("Adding folder...");
                      handleApply();
                    }
                  }}
                />
                {folderError && (
                  <p className="text-xs text-red-400/80 mt-1">{folderError}</p>
                )}
                <p className="text-xs text-gray-600 mt-1.5">
                  Leave empty to skip and add folders later from the Library
                  page.
                </p>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-panel-500/5 border border-panel-500/10">
                <Library className="w-4 h-4 text-panel-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-300 font-medium">
                    What is a library folder?
                  </p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    A library folder is any directory on your computer where you
                    keep comic files. PanelShelf scans it to discover your
                    comics and track your reading progress. You can add
                    multiple folders and they'll appear in the Library.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50 flex items-center justify-between">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={completeOnboarding}
                className="btn-ghost btn-sm text-gray-500"
              >
                Skip setup
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-primary"
                disabled={isLoading}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={applying}
                className="btn-ghost btn-sm"
              >
                Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={completeOnboarding}
                  disabled={applying}
                  className="btn-ghost btn-sm text-gray-500"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying}
                  className="btn-primary"
                >
                  {applying ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {applyPhase || "Applying..."}
                    </span>
                  ) : folderPath.trim() ? (
                    "Add Folder & Finish"
                  ) : (
                    "Finish Setup"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
