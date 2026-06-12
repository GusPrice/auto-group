import { SyncItem } from '../adapters/types';
import { storage } from './Storage';
import { getAdapter } from '../adapters';

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;

/** Only http(s) URLs are safe to open as tabs; reject javascript:, data:, file:, etc. */
function isSafeWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export interface TabManagerOptions {
  // Stable, unique identifier for this tab group in storage. A single adapter
  // can own several groups (e.g. one per repo), so this is distinct from the
  // adapter name.
  groupKey: string;
  groupTitle: string;
  // Used to map tab URLs back to item ids (adapter-specific), and to key lastSync.
  adapterName: string;
}

export class TabManager {
  private groupKey: string;
  private groupTitle: string;
  private adapterName: string;

  constructor(options: TabManagerOptions) {
    this.groupKey = options.groupKey;
    this.groupTitle = options.groupTitle;
    this.adapterName = options.adapterName;
  }

  async getGroupId(): Promise<number | null> {
    const mapping = await storage.get('groupMapping');
    return mapping[this.groupKey] || null;
  }

  async setGroupId(groupId: number): Promise<void> {
    const mapping = await storage.get('groupMapping');
    mapping[this.groupKey] = groupId;
    await storage.set('groupMapping', mapping);
  }

  async syncGroup(items: SyncItem[]): Promise<void> {
    const itemIds = new Set(items.map(item => item.id));

    // Validate the group id on record, if any.
    let storedGroupId = await this.getGroupId();
    if (storedGroupId) {
      try {
        await browser.tabGroups.get(storedGroupId);
      } catch {
        storedGroupId = null;
      }
    }

    // Find every group (in any window) carrying our title: our group plus any
    // accidental duplicates created by races or by an earlier version syncing
    // against the wrong window. We collapse them all into one canonical group
    // below, so duplicates self-heal.
    const titleGroups = await browser.tabGroups.query({ title: this.groupTitle });

    // Canonical group: prefer the one we already own, otherwise any match.
    const canonical = titleGroups.find(g => g.id === storedGroupId) ?? titleGroups[0] ?? null;
    const canonicalId = canonical ? canonical.id : null;
    const takingOwnership = canonicalId !== null && canonicalId !== storedGroupId;

    // Anchor work to the group's own window — never browser.windows.getCurrent(),
    // which is unreliable in a service worker and, with multiple windows open,
    // caused tabs to be created in one window and grouped into another.
    let windowId: number | undefined = canonical?.windowId;
    if (windowId === undefined) {
      const focused = await browser.windows
        .getLastFocused({ windowTypes: ['normal'] })
        .catch(() => null);
      windowId = focused?.id ?? (await browser.windows.getCurrent()).id;
    }
    if (windowId === undefined) return;

    // Managed tabs = tabs in any title-matched group (across windows), so
    // duplicate groups are absorbed rather than left behind.
    const titleGroupIds = new Set(titleGroups.map(g => g.id));
    const allTabs = await browser.tabs.query({});
    const managedTabs = allTabs.filter(t => t.groupId !== undefined && titleGroupIds.has(t.groupId));

    // Keep one tab per current item id; drop stale PRs and duplicate tabs.
    const tabsToRemove: number[] = [];
    const keptItemIds = new Set<string>();
    const keepTabIds: number[] = [];
    for (const tab of managedTabs) {
      const itemId = tab.url ? this.extractItemId(tab.url) : null;
      if (!itemId) continue; // leave unrecognized tabs alone
      if (!itemIds.has(itemId)) {
        if (tab.id !== undefined) tabsToRemove.push(tab.id); // stale PR
      } else if (keptItemIds.has(itemId)) {
        if (tab.id !== undefined) tabsToRemove.push(tab.id); // duplicate of a kept tab
      } else {
        keptItemIds.add(itemId);
        if (tab.id !== undefined) keepTabIds.push(tab.id);
      }
    }

    // Add tabs for items not already represented by a kept tab.
    const tabsToAdd: number[] = [];
    const queuedTabIds = new Set<number>();
    for (const item of items) {
      if (keptItemIds.has(item.id)) continue; // already in group OR handled this pass
      keptItemIds.add(item.id);

      const existingTab = allTabs.find(t => t.url && this.extractItemId(t.url) === item.id);
      if (existingTab?.id !== undefined) {
        if (!queuedTabIds.has(existingTab.id)) {
          tabsToAdd.push(existingTab.id);
          queuedTabIds.add(existingTab.id);
        }
      } else {
        // Only open http(s) URLs. API responses drive tab creation, so reject
        // anything else (javascript:, data:, file:, etc.) before navigating.
        if (!isSafeWebUrl(item.url)) {
          console.warn(`[Auto Groups] Skipping item with unsafe URL: ${item.url}`);
          continue;
        }
        const newTab = await browser.tabs.create({ url: item.url, active: false, windowId });
        if (newTab.id !== undefined) {
          tabsToAdd.push(newTab.id);
          queuedTabIds.add(newTab.id);
        }
      }
    }

    if (tabsToRemove.length > 0) {
      await browser.tabs.ungroup(tabsToRemove as [number, ...number[]]);
      await browser.tabs.remove(tabsToRemove);
    }

    // Every tab that should live in the group: survivors + newly added.
    // Grouping them all into the canonical group drains any duplicate groups,
    // which then empty out and are removed by the browser.
    const finalTabIds = [...new Set([...keepTabIds, ...tabsToAdd])];
    if (finalTabIds.length === 0) {
      await this.touchLastSync();
      return;
    }

    if (canonicalId !== null) {
      await browser.tabs.group({ tabIds: finalTabIds as [number, ...number[]], groupId: canonicalId });
      // (Re)apply our color only when first taking ownership of a group; once
      // owned, leave the color alone so a manual recolor is preserved.
      await browser.tabGroups.update(canonicalId, {
        title: this.groupTitle,
        ...(takingOwnership ? { color: this.colorForGroup() } : {}),
      });
      await this.setGroupId(canonicalId);
    } else {
      const newGroupId = await browser.tabs.group({ tabIds: finalTabIds as [number, ...number[]] });
      await browser.tabGroups.update(newGroupId, {
        title: this.groupTitle,
        color: this.colorForGroup(),
      });
      await this.setGroupId(newGroupId);
    }

    await this.touchLastSync();
  }

  private async touchLastSync(): Promise<void> {
    const lastSync = await storage.get('lastSync');
    lastSync[this.adapterName] = Date.now();
    await storage.set('lastSync', lastSync);
  }

  // Deterministic color per group so it stays stable across reloads and does
  // not depend on the order groups happen to be created in (which previously
  // made the first group always grey).
  private colorForGroup(): (typeof GROUP_COLORS)[number] {
    let hash = 0;
    for (let i = 0; i < this.groupKey.length; i++) {
      hash = (hash * 31 + this.groupKey.charCodeAt(i)) | 0;
    }
    return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
  }

  private extractItemId(url: string): string | null {
    const adapter = getAdapter(this.adapterName);
    if (adapter && adapter.extractItemIdFromUrl) {
      return adapter.extractItemIdFromUrl(url);
    }

    const match = url.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/);
    if (match) {
      return `${match[1]}#${match[2]}`;
    }
    const prMatch = url.match(/\/pull\/(\d+)/);
    if (prMatch) {
      return prMatch[1];
    }
    return null;
  }

  async removeGroup(): Promise<void> {
    const groupId = await this.getGroupId();
    if (!groupId) return;

    try {
      const tabs = await browser.tabs.query({ groupId: groupId });
      const tabIds = tabs.map(t => t.id).filter((id): id is number => id !== undefined);
      
      if (tabIds.length > 0) {
        await browser.tabs.ungroup(tabIds as [number, ...number[]]);
        await browser.tabs.remove(tabIds);
      }

      const mapping = await storage.get('groupMapping');
      delete mapping[this.groupKey];
      await storage.set('groupMapping', mapping);
    } catch {
      const mapping = await storage.get('groupMapping');
      delete mapping[this.groupKey];
      await storage.set('groupMapping', mapping);
    }
  }
}

export async function findTabByUrl(url: string): Promise<browser.tabs.Tab | null> {
  const tabs = await browser.tabs.query({ url });
  return tabs[0] || null;
}

export async function createTab(url: string): Promise<browser.tabs.Tab> {
  return browser.tabs.create({ url, active: false });
}
