import type { ProviderAdapter } from "./types";

const providers = new Map<string, ProviderAdapter>();

export function registerProvider(provider: ProviderAdapter) {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return providers.get(id);
}

export function getAllProviders(): ProviderAdapter[] {
  return Array.from(providers.values());
}

export function findProviderForUrl(url: string): ProviderAdapter | undefined {
  return getAllProviders().find((p) => p.canHandle(url));
}
