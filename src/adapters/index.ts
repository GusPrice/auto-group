import type { AdapterWithInstall, AdapterRegistry, AvailableAdapters, AvailableAdapter } from './types';
import { githubAdapter } from './github';

export type { AdapterWithInstall, SyncItem, PullRequest, AdapterRegistry, AvailableAdapter, AvailableAdapters } from './types';
export { githubAdapter } from './github';

export const adapterRegistry: AdapterRegistry = {
  github: githubAdapter,
};

export const availableAdapters: AvailableAdapters = {
  github: {
    name: 'github',
    groupTitle: '🔄 GitHub PRs',
    description: 'Track your open PRs and PRs awaiting your review',
  },
};

export function getAdapter(name: string): AdapterWithInstall<any> | undefined {
  return adapterRegistry[name];
}

export function getAllAdapters(): AdapterWithInstall<any>[] {
  return Object.values(adapterRegistry);
}

export function getAvailableAdaptersList(): AvailableAdapter[] {
  return Object.values(availableAdapters);
}

export function isAdapterAvailable(name: string): boolean {
  return !!availableAdapters[name];
}
