// ── Storage keys ──

const ONBOARDING_DONE_KEY = "panelshelf-onboarding-done";
const ONBOARDING_STEP_KEY = "panelshelf-onboarding-step";
const ONBOARDING_ENABLED_IDS_KEY = "panelshelf-onboarding-enabled-ids";

// ── Done flag ──

/** Check if the onboarding has been completed. */
export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Mark onboarding as completed. */
export function setOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, "true");
  } catch {
    // localStorage may not be available
  }
}

/** Reset the onboarding flag so the setup appears again on next render. */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
  } catch {
    // localStorage may not be available
  }
}

// ── Step ──

/** Read the saved onboarding step (1 or 2), or 1 if none saved. */
export function getSavedStep(): 1 | 2 {
  try {
    const saved = localStorage.getItem(ONBOARDING_STEP_KEY);
    if (saved === "2") return 2;
  } catch {
    // localStorage may not be available
  }
  return 1;
}

/** Persist the current onboarding step. */
export function saveStep(step: 1 | 2): void {
  try {
    localStorage.setItem(ONBOARDING_STEP_KEY, String(step));
  } catch {
    // localStorage may not be available
  }
}

// ── Enabled provider IDs ──

/** Read the saved set of enabled provider IDs, or an empty set. */
export function getSavedEnabledIds(): Set<string> {
  try {
    const saved = localStorage.getItem(ONBOARDING_ENABLED_IDS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // localStorage may not be available
  }
  return new Set();
}

/** Persist the enabled provider IDs as a JSON array. */
export function saveEnabledIds(ids: Set<string>): void {
  try {
    localStorage.setItem(
      ONBOARDING_ENABLED_IDS_KEY,
      JSON.stringify([...ids])
    );
  } catch {
    // localStorage may not be available
  }
}

// ── Saved-state detection ──

/** Check if there is any saved onboarding state (step > 1 or provider selections). */
export function hasSavedState(): boolean {
  try {
    const savedStep = localStorage.getItem(ONBOARDING_STEP_KEY);
    const savedIds = localStorage.getItem(ONBOARDING_ENABLED_IDS_KEY);
    return savedStep === "2" || (savedIds !== null && savedIds !== "[]");
  } catch {
    return false;
  }
}

// ── Cleanup ──

/** Remove all onboarding state from localStorage (called on completion). */
export function clearOnboardingStorage(): void {
  try {
    localStorage.removeItem(ONBOARDING_STEP_KEY);
    localStorage.removeItem(ONBOARDING_ENABLED_IDS_KEY);
  } catch {
    // localStorage may not be available
  }
}
