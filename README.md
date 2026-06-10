# Auto Groups

A browser extension that automatically manages tab groups based on external APIs like GitHub PRs.

## Features

- **Modular Adapter Architecture** - Easily add new integrations (GitHub, GitLab, Jira, etc.)
- **GitHub Integration** - Your open PRs grouped per repo, plus a single group for PRs awaiting your review; stale PRs (no activity in 2 months) are skipped
- **Automatic Tab Grouping** - Creates and manages tab groups seamlessly
- **Configurable Polling** - Set sync intervals (1, 5, 10, or 30 minutes)
- **Two Fetch Modes**:
  - **Run together** - All adapters sync with a shared interval
  - **Run individually** - Each adapter has its own polling interval

## Installation

> New here? See **[SETUP.md](./SETUP.md)** for a step-by-step Chrome guide,
> including how to create the right GitHub token.

### Chrome
1. Build the extension: `npm run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `.output/chrome-mv3/`

### Firefox
1. Build the extension: `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select `.output/firefox-mv2/manifest.json`

**Note**: Firefox requires version 138+ for tab groups support.

## Development

```bash
# Install dependencies
npm install

# Development (Chrome)
npm run dev

# Development (Firefox)
npm run dev:firefox

# Build for Chrome
npm run build

# Build for Firefox
npm run build:firefox
```

## Adding New Adapters

To add a new adapter (e.g., GitLab, Jira):

1. Create `src/adapters/[adapter-name].ts`:

```typescript
import { AdapterWithInstall } from './types';
import { getAdapterConfig, setAdapterConfig } from '../core/Storage';

export const myAdapter: AdapterWithInstall<MyItem> = {
  name: 'myadapter',
  groupTitle: '🔄 My Adapter',
  description: 'Description of what this adapter does',
  
  async install() {
    await setAdapterConfig('myadapter', {
      enabled: true,
      pollingInterval: 5,
      config: {},
    });
  },
  
  async uninstall() {
    // Cleanup if needed
  },
  
  async fetchItems() {
    // Fetch data from external API
  },
  
  getItemUrl(item) { return item.url; },
  getItemId(item) { return item.id; },
  getItemTitle(item) { return item.title; },
};
```

2. Register in `src/adapters/index.ts`:

```typescript
import { myAdapter } from './myadapter';

export const adapterRegistry = {
  github: githubAdapter,
  myadapter: myAdapter,
};

export const availableAdapters = {
  github: { name: 'github', groupTitle: '🔄 GitHub Reviews', description: '...' },
  myadapter: { name: 'myadapter', groupTitle: '🔄 My Adapter', description: '...' },
};
```

## Tech Stack

- [WXT](https://wxt.dev/) - Web Extension Framework
- React 19
- TypeScript
- Chrome/Firefox Manifest V3

## Permissions

- `tabs` - Create and manage tabs
- `tabGroups` - Create and manage tab groups
- `storage` - Store adapter configurations
- `alarms` - Schedule periodic polling
- `https://api.github.com/` - Access GitHub API
- `https://*/*` (optional) - Requested only when you configure a custom GitHub Enterprise host

## Security

- **Use a minimally-scoped, expiring token.** The GitHub integration only needs
  read access to pull requests where you're a requested reviewer. Prefer a
  [fine-grained personal access token](https://github.com/settings/tokens?type=beta)
  with read-only **Pull requests** access and a short expiry. Avoid classic
  tokens with broad `repo` scope.
- **Token storage.** Your token is stored in the browser's extension-local
  storage (`browser.storage.local`) so it can be used for background polling.
  Like all extension storage this is unencrypted at rest, so only install on a
  machine you trust, and revoke the token in GitHub settings if you uninstall.
- **Custom hosts.** If you point the extension at a custom/Enterprise host, your
  token is sent to that host as an authorization credential. The extension
  validates the URL and asks you to confirm before sending — only use hosts you
  trust.
- **Dependency audit.** `npm audit` currently reports advisories, but they all
  originate from build/dev tooling (`wxt` → `web-ext-run` → `tmp`/`fx-runner`/
  `node-notifier`) that is **not bundled into the shipped extension**. The
  project already tracks the latest `wxt`; these will clear when the upstream
  toolchain updates its transitive dependencies.
