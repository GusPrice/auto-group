import { AdapterWithInstall, PullRequest, SyncItem, SyncGroup } from './types';
import { getAdapterConfig, setAdapterConfig } from '../core/Storage';

// PRs with no activity in this window are not opened as tabs.
const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000; // ~2 months

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

async function searchPRs(baseUrl: string, token: string, query: string): Promise<PullRequest[]> {
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
  return (data.items ?? []) as PullRequest[];
}

// GitHub search can't OR these qualifiers in one query, so fetch your open PRs
// and the open PRs awaiting your review separately. Drafts are included (no
// draft:false qualifier); only open PRs are returned.
async function fetchAuthoredAndReview(): Promise<{ authored: PullRequest[]; reviewRequested: PullRequest[] }> {
  const { token, host } = await getGithubConfig();
  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const cleanHost = host.replace(/\/$/, '');
  const isEnterprise = cleanHost !== 'https://api.github.com' && !cleanHost.includes('api.github.com');
  const baseUrl = isEnterprise ? `${cleanHost}/api/v3` : cleanHost;

  const [authored, reviewRequested] = await Promise.all([
    searchPRs(baseUrl, token, 'state:open is:pr author:@me'),
    searchPRs(baseUrl, token, 'state:open is:pr user-review-requested:@me'),
  ]);

  return { authored, reviewRequested };
}

export async function fetchTrackedPRs(): Promise<PullRequest[]> {
  const { authored, reviewRequested } = await fetchAuthoredAndReview();
  const byId = new Map<number, PullRequest>();
  for (const pr of [...authored, ...reviewRequested]) {
    byId.set(pr.id, pr);
  }
  return Array.from(byId.values());
}

// PRs updated within the staleness window only.
function isRecentlyActive(pr: PullRequest): boolean {
  const updated = Date.parse(pr.updated_at);
  if (Number.isNaN(updated)) return true; // keep if we can't parse a date
  return Date.now() - updated <= STALE_AFTER_MS;
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
  groupTitle: '🔄 GitHub PRs',
  description: 'Track your open PRs and PRs awaiting your review',

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
    return fetchTrackedPRs();
  },

  async fetchGroups(): Promise<SyncGroup[]> {
    const { authored, reviewRequested } = await fetchAuthoredAndReview();
    const toItem = (pr: PullRequest): SyncItem => ({
      id: this.getItemId(pr),
      url: this.getItemUrl(pr),
      title: this.getItemTitle(pr),
    });

    const groups: SyncGroup[] = [];

    // PRs awaiting my review → one combined group.
    const reviewItems = reviewRequested.filter(isRecentlyActive).map(toItem);
    if (reviewItems.length > 0) {
      groups.push({ key: 'github:review', title: '👀 Awaiting my review', items: reviewItems });
    }

    // PRs I authored → one group per repo.
    const byRepo = new Map<string, SyncItem[]>();
    for (const pr of authored.filter(isRecentlyActive)) {
      const repo = extractRepoFromUrl(pr.repository_url).fullName;
      const items = byRepo.get(repo);
      if (items) {
        items.push(toItem(pr));
      } else {
        byRepo.set(repo, [toItem(pr)]);
      }
    }
    for (const [repo, items] of byRepo) {
      groups.push({ key: `github:author:${repo}`, title: repo, items });
    }

    return groups;
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
