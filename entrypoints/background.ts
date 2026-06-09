import { getAdapter, getAllAdapters, SyncGroup } from '../src/adapters';
import { TabManager } from '../src/core/TabManager';
import { storage, getSettings, getAdapterConfig } from '../src/core/Storage';
import {
  MASTER_ALARM_NAME,
  ADAPTER_ALARM_PREFIX,
  onAlarm,
  updatePolling
} from '../src/core/Scheduler';

async function runAdapterSync(adapterName: string): Promise<void> {
  const adapter = getAdapter(adapterName);
  if (!adapter) {
    console.error(`Adapter not found: ${adapterName}`);
    return;
  }

  const config = await getAdapterConfig(adapterName);
  if (!config || !config.enabled) {
    console.log(`Adapter ${adapterName} is disabled, skipping`);
    return;
  }

  try {
    console.log(`[Auto Groups] Fetching items for ${adapterName}...`);

    if (adapter.fetchGroups) {
      // Multi-group adapter: it decides how items map to tab groups.
      const groups = await adapter.fetchGroups();
      await syncAdapterGroups(adapterName, groups);
    } else {
      // Single-group adapter: everything goes into one group keyed by name.
      const items = await adapter.fetchItems();
      const syncItems = items.map(item => ({
        id: adapter.getItemId(item),
        url: adapter.getItemUrl(item),
        title: adapter.getItemTitle(item),
      }));
      const tabManager = new TabManager({
        groupKey: adapter.name,
        groupTitle: adapter.groupTitle,
        adapterName: adapter.name,
      });
      await tabManager.syncGroup(syncItems);
      console.log(`[Auto Groups] Synced ${syncItems.length} items for ${adapterName}`);
    }
  } catch (error) {
    console.error(`[Auto Groups] Error syncing ${adapterName}:`, error);
  }
}

async function syncAdapterGroups(adapterName: string, groups: SyncGroup[]): Promise<void> {
  console.log(`[Auto Groups] ${adapterName}: syncing ${groups.length} group(s)`);

  // Sync the current groups first so tabs can be moved/reused between groups
  // before any stale groups are torn down.
  for (const group of groups) {
    const tabManager = new TabManager({
      groupKey: group.key,
      groupTitle: group.title,
      adapterName,
    });
    await tabManager.syncGroup(group.items);
  }

  // Remove groups this adapter previously owned that no longer apply: a repo
  // with no open PRs, a category that emptied out, or the legacy single
  // combined group (keyed by the bare adapter name).
  const currentKeys = new Set(groups.map(g => g.key));
  const mapping = await storage.get('groupMapping');
  for (const key of Object.keys(mapping)) {
    const ownedByAdapter = key === adapterName || key.startsWith(`${adapterName}:`);
    if (ownedByAdapter && !currentKeys.has(key)) {
      const tabManager = new TabManager({ groupKey: key, groupTitle: '', adapterName });
      await tabManager.removeGroup();
    }
  }
}

async function syncAllAdapters(): Promise<void> {
  const settings = await getSettings();

  if (settings.fetchMode === 'together') {
    const adapters = getAllAdapters();
    for (const adapter of adapters) {
      await runAdapterSync(adapter.name);
    }
  } else {
    const installedAdapters = Object.keys(settings.installedAdapters);
    for (const adapterName of installedAdapters) {
      await runAdapterSync(adapterName);
    }
  }
}

async function syncAdapter(adapterName: string): Promise<void> {
  const settings = await getSettings();

  if (settings.fetchMode === 'together') {
    await runAdapterSync(adapterName);
  } else {
    await runAdapterSync(adapterName);
  }
}

export default defineBackground(() => {
  console.log('Auto Groups extension started');

  browser.runtime.onInstalled.addListener(async () => {
    console.log('Extension installed');
    await updatePolling();
  });

  onAlarm(async (alarm) => {
    console.log(`[Auto Groups] Alarm triggered: ${alarm.name}`);

    if (alarm.name === MASTER_ALARM_NAME) {
      await syncAllAdapters();
    } else if (alarm.name.startsWith(ADAPTER_ALARM_PREFIX)) {
      const adapterName = alarm.name.replace(ADAPTER_ALARM_PREFIX, '');
      await syncAdapter(adapterName);
    }
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local') {
      if (changes.fetchMode || changes.masterEnabled || changes.globalPollingInterval || changes.installedAdapters) {
        await updatePolling();
      }
    }
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SYNC_NOW') {
      console.log('[Auto Groups] Manual sync triggered');
      syncAllAdapters().then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'SYNC_ADAPTER') {
      console.log(`[Auto Groups] Manual sync for ${message.adapterName}`);
      syncAdapter(message.adapterName).then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_STATUS') {
      getSettings().then(settings => {
        const installed = Object.keys(settings.installedAdapters);

        const adaptersWithMeta: Record<string, any> = {};
        for (const name of installed) {
          const adapter = getAdapter(name);
          adaptersWithMeta[name] = {
            ...settings.installedAdapters[name],
            groupTitle: adapter?.groupTitle || name,
          };
        }

        sendResponse({
          fetchMode: settings.fetchMode,
          masterEnabled: settings.masterEnabled,
          globalPollingInterval: settings.globalPollingInterval,
          installedAdapters: adaptersWithMeta,
          installedList: installed,
        });
      });
      return true;
    }

    if (message.type === 'UPDATE_SETTINGS') {
      const { fetchMode, masterEnabled, globalPollingInterval } = message;
      storage.setMultiple({
        fetchMode,
        masterEnabled,
        globalPollingInterval,
      }).then(async () => {
        await updatePolling();
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'UPDATE_ADAPTER_CONFIG') {
      const { adapterName, enabled, pollingInterval, config } = message;
      const redactConfig = (c: Record<string, any> | undefined) =>
        c && 'token' in c ? { ...c, token: c.token ? '[redacted]' : c.token } : c;
      console.log('[Auto Groups] UPDATE_ADAPTER_CONFIG:', { adapterName, enabled, pollingInterval, config: redactConfig(config) });
      getAdapterConfig(adapterName).then(currentConfig => {
        if (currentConfig) {
          storage.get('installedAdapters').then(adapters => {
            const newConfig = {
              enabled: enabled !== undefined ? enabled : currentConfig.enabled,
              pollingInterval: pollingInterval !== undefined ? pollingInterval : currentConfig.pollingInterval,
              config: { ...currentConfig.config, ...config },
            };
            console.log('[Auto Groups] New config:', { ...newConfig, config: redactConfig(newConfig.config) });
            storage.set('installedAdapters', {
              ...adapters,
              [adapterName]: newConfig,
            }).then(async () => {
              await updatePolling();
              sendResponse({ success: true });
            });
          });
        } else {
          sendResponse({ success: false, error: 'Adapter not found' });
        }
      });
      return true;
    }

    if (message.type === 'INSTALL_ADAPTER') {
      const adapter = getAdapter(message.adapterName);
      if (adapter) {
        adapter.install().then(async () => {
          await updatePolling();
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Adapter not found' });
      }
      return true;
    }

    if (message.type === 'UNINSTALL_ADAPTER') {
      const adapter = getAdapter(message.adapterName);
      if (adapter) {
        adapter.uninstall().then(() => {
          storage.get('installedAdapters').then(adapters => {
            delete adapters[message.adapterName];
            storage.set('installedAdapters', adapters).then(async () => {
              await updatePolling();
              sendResponse({ success: true });
            });
          });
        });
      } else {
        sendResponse({ success: false, error: 'Adapter not found' });
      }
      return true;
    }
  });

});
