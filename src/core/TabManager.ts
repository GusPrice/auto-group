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
  groupTitle: string;
  adapterName: string;
}

export class TabManager {
  private groupTitle: string;
  private adapterName: string;

  constructor(options: TabManagerOptions) {
    this.groupTitle = options.groupTitle;
    this.adapterName = options.adapterName;
  }

  async getGroupId(): Promise<number | null> {
    const mapping = await storage.get('groupMapping');
    return mapping[this.adapterName] || null;
  }

  async setGroupId(groupId: number): Promise<void> {
    const mapping = await storage.get('groupMapping');
    mapping[this.adapterName] = groupId;
    await storage.set('groupMapping', mapping);
  }

  async syncGroup(items: SyncItem[]): Promise<void> {
    const currentWindow = await browser.windows.getCurrent();
    if (!currentWindow.id) return;

    const itemIds = new Set(items.map(item => item.id));
    let existingGroupId = await this.getGroupId();
    let groupId = existingGroupId;

    if (groupId) {
      try {
        await browser.tabGroups.get(groupId);
      } catch {
        groupId = null;
      }
    }

    const allTabs = await browser.tabs.query({ windowId: currentWindow.id });
    const managedTabs: browser.tabs.Tab[] = [];

    if (groupId) {
      for (const tab of allTabs) {
        if (tab.groupId === groupId) {
          managedTabs.push(tab);
        }
      }
    }

    const tabsToRemove: number[] = [];

    for (const tab of managedTabs) {
      if (tab.url) {
        const itemId = this.extractItemId(tab.url);
        if (itemId && !itemIds.has(itemId)) {
          tabsToRemove.push(tab.id!);
        }
      }
    }

    const tabsToAdd: number[] = [];
    const existingItemIds = new Set(
      managedTabs.map(t => t.url ? this.extractItemId(t.url) : null).filter((id): id is string => !!id)
    );

    for (const item of items) {
      if (!existingItemIds.has(item.id)) {
        const existingTab = allTabs.find(t => t.url && this.extractItemId(t.url) === item.id);
        if (existingTab) {
          tabsToAdd.push(existingTab.id!);
        } else {
          // Only open http(s) URLs. API responses drive tab creation, so reject
          // anything else (javascript:, data:, file:, etc.) before navigating.
          if (!isSafeWebUrl(item.url)) {
            console.warn(`[Auto Groups] Skipping item with unsafe URL: ${item.url}`);
            continue;
          }
          const newTab = await browser.tabs.create({ url: item.url, active: false });
          tabsToAdd.push(newTab.id!);
        }
      }
    }

    if (tabsToRemove.length > 0) {
      await browser.tabs.ungroup(tabsToRemove as [number, ...number[]]);
      await browser.tabs.remove(tabsToRemove);
    }

    if (tabsToAdd.length === 0 && managedTabs.length === 0) {
      return;
    }

    if (tabsToAdd.length > 0) {
      if (groupId) {
        const groupTabs = await browser.tabs.query({ groupId: groupId });
        const currentTabIds = groupTabs.map(t => t.id).filter((id): id is number => id !== undefined);
        if (currentTabIds.length > 0) {
          const allTabIds = [...currentTabIds, ...tabsToAdd];
          await browser.tabs.group({ tabIds: allTabIds as [number, ...number[]], groupId: groupId });
        } else {
          await browser.tabs.group({ tabIds: tabsToAdd as [number, ...number[]], groupId: groupId });
        }
        await browser.tabGroups.update(groupId, { title: this.groupTitle });
      } else {
        const newGroupId = await browser.tabs.group({ tabIds: tabsToAdd as [number, ...number[]] });
        const mapping = await storage.get('groupMapping');
        const colorIndex = Object.keys(mapping).length % GROUP_COLORS.length;
        await browser.tabGroups.update(newGroupId, {
          title: this.groupTitle,
          color: GROUP_COLORS[colorIndex],
        });
        await this.setGroupId(newGroupId);
      }
    }

    const lastSync = await storage.get('lastSync');
    lastSync[this.adapterName] = Date.now();
    await storage.set('lastSync', lastSync);
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
      delete mapping[this.adapterName];
      await storage.set('groupMapping', mapping);
    } catch {
      const mapping = await storage.get('groupMapping');
      delete mapping[this.adapterName];
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
