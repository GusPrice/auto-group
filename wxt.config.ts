import { defineConfig } from 'wxt';

export default defineConfig({
  autoIcons: {
    baseIconPath: "assets/icon.svg"
  },
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: ({ manifestVersion }) => ({
    name: 'Auto Groups',
    description: 'Automatically manage tab groups based on external APIs like GitHub PRs',
    permissions: ['tabs', 'tabGroups', 'storage', 'alarms'],
    host_permissions: ['https://api.github.com/'],
    optional_host_permissions: ['https://*/*'],
    // Lock extension pages down to self-hosted scripts. MV3 expects an object,
    // MV2 (Firefox) expects a string.
    content_security_policy: manifestVersion === 3
      ? { extension_pages: "script-src 'self'; object-src 'self'" }
      : "script-src 'self'; object-src 'self'",
    browser_specific_settings: {
      gecko: {
        id: 'auto-groups@extension.dev',
        strict_min_version: '138.0',
        // @ts-ignore - WXT doesn't support this field yet
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  }),
});
