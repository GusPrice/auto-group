import { useState, useEffect } from 'react';
import './style.css';

type Tab = 'installed' | 'store' | 'settings';

interface AdapterStatus {
  name: string;
  groupTitle: string;
  description: string;
  enabled: boolean;
  pollingInterval?: number;
  config: Record<string, any>;
}

interface Status {
  fetchMode: 'together' | 'individual';
  masterEnabled: boolean;
  globalPollingInterval: number;
  installedAdapters: Record<string, AdapterStatus>;
  installedList: string[];
}

const availableAdaptersList = [
  {
    name: 'github',
    groupTitle: '🔄 GitHub Reviews',
    description: 'Track PRs where you are a requested reviewer',
  },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_STATUS' });
      setStatus(response);
    } catch (err) {
      console.error('Failed to load status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (adapterName: string) => {
    setSaving(true);
    try {
      const response = await browser.runtime.sendMessage({ type: 'INSTALL_ADAPTER', adapterName });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to install adapter');
      }
      await loadStatus();
      setSuccess('Adapter installed!');
    } catch (err: any) {
      setError(err.message || 'Failed to install adapter');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const handleUninstall = async (adapterName: string) => {
    setSaving(true);
    try {
      const response = await browser.runtime.sendMessage({ type: 'UNINSTALL_ADAPTER', adapterName });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to uninstall adapter');
      }
      await loadStatus();
      setSuccess('Adapter uninstalled');
    } catch (err: any) {
      setError(err.message || 'Failed to uninstall adapter');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const handleToggleAdapter = async (adapterName: string, enabled: boolean) => {
    try {
      const response = await browser.runtime.sendMessage({ 
        type: 'UPDATE_ADAPTER_CONFIG', 
        adapterName, 
        enabled 
      });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to update adapter');
      }
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to update adapter');
    }
  };

  const handleAdapterIntervalChange = async (adapterName: string, interval: number) => {
    try {
      const response = await browser.runtime.sendMessage({ 
        type: 'UPDATE_ADAPTER_CONFIG', 
        adapterName, 
        pollingInterval: interval 
      });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to update interval');
      }
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to update interval');
    }
  };

  const handleSaveConfig = async (adapterName: string, token: string, rawHost: string): Promise<boolean> => {
    try {
      let host = rawHost.trim();
      if (host) {
        if (!/^https?:\/\//i.test(host)) {
          host = `https://${host}`;
        }
        host = host.replace(/\/api\/v3\/?$/i, '');
        host = host.replace(/\/+$/, '');

        // Validate the host is a well-formed https origin before we ever send
        // the token to it. The token is transmitted as a Bearer credential to
        // this host, so a malformed/unexpected value must not slip through.
        let parsed: URL;
        try {
          parsed = new URL(host);
        } catch {
          setError('Invalid GitHub host URL.');
          return false;
        }
        if (parsed.protocol !== 'https:') {
          setError('GitHub host must use https://.');
          return false;
        }
        if (!parsed.hostname || parsed.username || parsed.password) {
          setError('GitHub host must be a plain https origin without credentials.');
          return false;
        }
        // Normalize to scheme + host (+ explicit port) only — drop any path/query.
        host = parsed.origin;
      }

      // If it's a custom host, warn that the token will be sent there, then request permissions.
      if (host && host !== 'https://api.github.com') {
        const confirmed = window.confirm(
          `Your GitHub token will be sent as an authorization credential to:\n\n${host}\n\n` +
          `Only continue if you trust this host. Proceed?`
        );
        if (!confirmed) {
          setError('Cancelled: token was not sent to the custom host.');
          return false;
        }

        const origin = `${host}/*`;

        try {
          const granted = await browser.permissions.request({
            origins: [origin]
          });

          if (!granted) {
            setError('Permission denied for custom host. You must grant permission to access the enterprise URL.');
            return false;
          }
        } catch (permErr: any) {
          setError(`Invalid host URL or permission error: ${permErr.message || permErr}`);
          return false;
        }
      }

      const response = await browser.runtime.sendMessage({ 
        type: 'UPDATE_ADAPTER_CONFIG', 
        adapterName, 
        config: { token, host } 
      });
      
      if (response && response.success === false) {
        throw new Error(response.error || 'Background script rejected the update');
      }
      
      await loadStatus();
      setSuccess('Config saved!');
      setTimeout(() => setSuccess(null), 3000);
      return true;
    } catch (err: any) {
      setError(err.message || 'Failed to save config');
      return false;
    }
  };

  const handleSettingsUpdate = async (fetchMode: 'together' | 'individual', interval: number) => {
    setSaving(true);
    try {
      const response = await browser.runtime.sendMessage({ 
        type: 'UPDATE_SETTINGS', 
        fetchMode, 
        globalPollingInterval: interval 
      });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to save settings');
      }
      await loadStatus();
      setSuccess('Settings saved!');
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  const handleSyncNow = async () => {
    setSaving(true);
    try {
      const response = await browser.runtime.sendMessage({ type: 'SYNC_NOW' });
      if (response && response.success === false) {
        throw new Error(response.error || 'Failed to sync');
      }
      setSuccess('Sync triggered!');
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to sync');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  if (loading || !status) {
    return (
      <div className="container">
        <div className="card">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'installed' ? 'active' : ''}`}
          onClick={() => setActiveTab('installed')}
        >
          Installed
        </button>
        <button 
          className={`tab ${activeTab === 'store' ? 'active' : ''}`}
          onClick={() => setActiveTab('store')}
        >
          Store
        </button>
        <button 
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {activeTab === 'installed' && (
        <InstalledTab 
          status={status} 
          onToggle={handleToggleAdapter}
          onIntervalChange={handleAdapterIntervalChange}
          onSaveConfig={handleSaveConfig}
          onUninstall={handleUninstall}
          onSyncNow={handleSyncNow}
          saving={saving}
        />
      )}

      {activeTab === 'store' && (
        <StoreTab 
          installedAdapters={status.installedList}
          onInstall={handleInstall}
          onConfigure={() => setActiveTab('installed')}
          saving={saving}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab 
          fetchMode={status.fetchMode}
          globalPollingInterval={status.globalPollingInterval}
          onUpdate={handleSettingsUpdate}
        />
      )}
    </div>
  );
}

function InstalledTab({ 
  status, 
  onToggle, 
  onIntervalChange, 
  onSaveConfig,
  onUninstall,
  onSyncNow,
  saving 
}: {
  status: Status;
  onToggle: (name: string, enabled: boolean) => void;
  onIntervalChange: (name: string, interval: number) => void;
  onSaveConfig: (name: string, token: string, host: string) => Promise<boolean>;
  onUninstall: (name: string) => void;
  onSyncNow: () => void;
  saving: boolean;
}) {
  // The token is a secret and is intentionally kept in memory only — never
  // persisted to localStorage (which is plaintext and survives across
  // sessions/updates). Only the non-sensitive host field is drafted to disk.
  const [tokenInput, setTokenInput] = useState<Record<string, string>>({});
  const [hostInput, setHostInput] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('draftHostInput');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Clean up any token draft left behind by older versions of the extension.
  useEffect(() => {
    localStorage.removeItem('draftTokenInput');
  }, []);

  useEffect(() => {
    localStorage.setItem('draftHostInput', JSON.stringify(hostInput));
  }, [hostInput]);

  const handleSaveWrapper = async (name: string, token: string, host: string) => {
    const success = await onSaveConfig(name, token, host);
    
    // Check if permission is already granted to clear drafts immediately
    // If not, they will be cleared next time the user saves successfully
    if (success) {
      if (token) {
        setTokenInput(prev => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
      if (host && host !== 'https://api.github.com') {
        setHostInput(prev => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }
    }
  };

  const installedList = Object.keys(status.installedAdapters);

  if (installedList.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>No adapters installed</p>
          <p className="info-text">Go to Store to install adapters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adapter-list">
      {installedList.map(name => {
        const adapter = status.installedAdapters[name];
        return (
          <div key={name} className="card adapter-card">
            <h3>{adapter.groupTitle}</h3>

            {status.fetchMode === 'individual' && (
              <div className="form-group">
                <label>Polling Interval</label>
                <select
                  value={adapter.pollingInterval || 5}
                  onChange={(e) => onIntervalChange(name, Number(e.target.value))}
                >
                  <option value={1}>Every 1 minute</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={10}>Every 10 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                </select>
              </div>
            )}

            {name === 'github' && (
              <div className="form-group">
                <label>GitHub Host</label>
                <input
                  type="text"
                  placeholder="https://api.github.com"
                  value={hostInput[name] !== undefined ? hostInput[name] : (adapter.config?.host || '')}
                  onChange={(e) => setHostInput({ ...hostInput, [name]: e.target.value })}
                />
                
                <label>GitHub Token</label>
                {adapter.config?.token ? (
                  <div className="token-configured">
                    <span className="token-badge">✓ Token configured</span>
                    <button 
                      className="btn btn-secondary"
                      onClick={() => {
                        handleSaveWrapper(name, '', hostInput[name] || adapter.config?.host || 'https://api.github.com');
                      }}
                    >
                      Remove Token
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxx"
                      value={tokenInput[name] || ''}
                      onChange={(e) => setTokenInput({ ...tokenInput, [name]: e.target.value })}
                    />
                    <button 
                      className="btn btn-primary"
                      onClick={() => {
                        if (tokenInput[name]) {
                          handleSaveWrapper(name, tokenInput[name], hostInput[name] || adapter.config?.host || 'https://api.github.com');
                        }
                      }}
                    >
                      Save Config
                    </button>
                  </>
                )}
                {adapter.config?.token && (
                  <button 
                    className="btn btn-primary"
                    style={{ marginTop: '10px' }}
                    onClick={() => {
                      handleSaveWrapper(name, adapter.config?.token, hostInput[name] || adapter.config?.host || 'https://api.github.com');
                    }}
                  >
                    Update Host
                  </button>
                )}
              </div>
            )}

            <div className="actions">
              <button 
                className="btn btn-secondary"
                onClick={onSyncNow}
                disabled={saving}
              >
                Sync Now
              </button>
              <button 
                className="btn btn-danger"
                onClick={() => onUninstall(name)}
                disabled={saving}
              >
                Uninstall
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StoreTab({ 
  installedAdapters, 
  onInstall, 
  onConfigure,
  saving 
}: {
  installedAdapters: string[];
  onInstall: (name: string) => void;
  onConfigure: () => void;
  saving: boolean;
}) {
  return (
    <div className="adapter-list">
      {availableAdaptersList.map(adapter => {
        const isInstalled = installedAdapters.includes(adapter.name);
        return (
          <div key={adapter.name} className="card adapter-card">
            <div className="adapter-header">
              <div className="adapter-info">
                <h3>{adapter.groupTitle}</h3>
                <p className="info-text">{adapter.description}</p>
              </div>
            </div>
            {isInstalled ? (
              <button 
                className="btn btn-secondary"
                onClick={onConfigure}
              >
                Configure
              </button>
            ) : (
              <button 
                className="btn btn-primary"
                onClick={() => onInstall(adapter.name)}
                disabled={saving}
              >
                Install
              </button>
            )}
          </div>
        );
      })}
      {availableAdaptersList.length === 0 && (
        <div className="card">
          <p className="empty-state">No adapters available.</p>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  fetchMode,
  globalPollingInterval,
  onUpdate,
}: {
  fetchMode: 'together' | 'individual';
  globalPollingInterval: number;
  onUpdate: (mode: 'together' | 'individual', interval: number) => void;
}) {
  const [mode, setMode] = useState(fetchMode);
  const [interval, setInterval] = useState(globalPollingInterval);

  const handleModeChange = (newMode: 'together' | 'individual') => {
    setMode(newMode);
    onUpdate(newMode, interval);
  };

  const handleIntervalChange = (newInterval: number) => {
    setInterval(newInterval);
    onUpdate(mode, newInterval);
  };

  return (
    <div className="card">
      <h3 className="card-title">Fetch Mode</h3>
      
      <div className="form-group">
        <div className="mode-options">
          <label className={`mode-option ${mode === 'together' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="mode"
              value="together"
              checked={mode === 'together'}
              onChange={() => handleModeChange('together')}
            />
            <span>Run together</span>
            <p className="info-text">All adapters sync with a shared interval</p>
          </label>
          <label className={`mode-option ${mode === 'individual' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="mode"
              value="individual"
              checked={mode === 'individual'}
              onChange={() => handleModeChange('individual')}
            />
            <span>Run individually</span>
            <p className="info-text">Each adapter has its own polling interval</p>
          </label>
        </div>
      </div>

      {mode === 'together' && (
        <div className="form-group">
          <label>Global Polling Interval</label>
          <select
            value={interval}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
          >
            <option value={1}>Every 1 minute</option>
            <option value={5}>Every 5 minutes</option>
            <option value={10}>Every 10 minutes</option>
            <option value={30}>Every 30 minutes</option>
          </select>
        </div>
      )}
    </div>
  );
}

export default App;
