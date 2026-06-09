import { AdapterWithInstall, PullRequest, SyncItem } from './types';
import { getAdapterConfig, setAdapterConfig } from '../core/Storage';

function extractRepoFromUrl(repositoryUrl: string): { fullName: string; name: string } {
  const match = repositoryUrl.match(/repos\/([^\/]+)\/([^\/]+)$/);
  if (match) {
    return { fullName: `${match[1]}/${match[2]}`, name: match[2] };
  }
  return { fullName: 'unknown', name: 'unknown' };
}

async function getGithubConfig(): Promise<{ token: string | null; host: string }> {
  const config = await getAdapterConfig('github');
  return {
    token: config?.config?.token || null,
    host: config?.config?.host || 'https://api.github.com',
  };
}

export async function fetchRequestedPRs(): Promise<PullRequest[]> {
  const { token, host } = await getGithubConfig();
  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const query = 'state:open is:pr user-review-requested:@me';
  const cleanHost = host.replace(/\/$/, '');
  const isEnterprise = cleanHost !== 'https://api.github.com' && !cleanHost.includes('api.github.com');
  const baseUrl = isEnterprise ? `${cleanHost}/api/v3` : cleanHost;
  const url = `${baseUrl}/search/issues?q=${encodeURIComponent(query)}&sort=updated&per_page=50`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    // Read the body for diagnostics only — log it, but do not surface the raw
    // response into user-facing error text (avoids reflecting unexpected
    // content from a custom/enterprise host back into the UI).
    const errorText = await response.text().catch(() => '');
    console.error(`[Auto Groups] GitHub API error ${response.status}:`, errorText);
    if (response.status === 401) {
      throw new Error('Invalid GitHub token');
    }
    if (response.status === 403) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items;
}

export async function saveConfig(token: string, host: string): Promise<void> {
  const config = await getAdapterConfig('github');
  if (config) {
    await setAdapterConfig('github', {
      ...config,
      config: { ...config.config, token, host },
    });
  }
}

export async function getSavedConfig(): Promise<{ token: string | null; host: string }> {
  return getGithubConfig();
}

export const githubAdapter: AdapterWithInstall<PullRequest> = {
  name: 'github',
  groupTitle: '🔄 GitHub Reviews',
  description: 'Track PRs where you are a requested reviewer',

  async install() {
    await setAdapterConfig('github', {
      enabled: true,
      pollingInterval: 5,
      config: {},
    });
  },

  async uninstall() {
    // Cleanup handled by storage
  },

  async fetchItems() {
    return fetchRequestedPRs();
  },

  getItemUrl(item: PullRequest): string {
    return item.html_url;
  },

  getItemId(item: PullRequest): string {
    const repo = extractRepoFromUrl(item.repository_url);
    return `${repo.fullName}#${item.number}`;
  },

  getItemTitle(item: PullRequest): string {
    const repo = extractRepoFromUrl(item.repository_url);
    return `${repo.name} #${item.number}: ${item.title}`;
  },

  extractItemIdFromUrl(url: string): string | null {
    const match = url.match(/([^\/]+\/[^\/]+)\/pull\/(\d+)/);
    if (match) {
      return `${match[1]}#${match[2]}`;
    }
    return null;
  },

  isItemActive(item: PullRequest): boolean {
    return item.state === 'open';
  },
};
