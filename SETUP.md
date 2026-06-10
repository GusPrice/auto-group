# Auto Groups — Setup Guide (Chrome)

Get the extension running in Chrome, including the GitHub token setup (which has
a couple of gotchas worth reading).

## 1. Prerequisites

- **Node.js 20+** and **npm** (check with `node -v`)
- **Google Chrome**

## 2. Build the extension

```bash
git clone <REPO_URL>
cd auto-group
npm install
npm run build:chrome
```

> ⚠️ Use `npm run build:chrome`, **not** `npm run build` — the `build` script
> requires [Bun](https://bun.sh). (If you have Bun installed, `npm run build`
> builds both Chrome + Firefox.)

This produces the loadable extension at **`.output/chrome-mv3/`**.

## 3. Load it into Chrome

1. Open **`chrome://extensions/`**
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the **`.output/chrome-mv3`** folder inside the repo
5. Pin it: click the puzzle-piece icon in the toolbar → pin **Auto Groups**

## 4. Create a GitHub token (important — read this)

You need a **classic** token. Fine-grained tokens are scoped to a single
owner, so they can't see private repos across multiple orgs.

1. Go to **https://github.com/settings/tokens/new** (this is "Tokens **(classic)**")
2. **Note:** `Auto Groups extension`
3. **Expiration:** 30–90 days (recommended)
4. **Scopes:** check **only `repo`** ✅ — leave everything else unchecked
5. Click **Generate token** and **copy it** (you won't see it again)
6. **If your org uses SAML SSO:** back on the token list, click **Configure SSO**
   next to the new token → **Authorize** it for your org. Without this, the
   org's private repos stay invisible.

> The `repo` scope is "full control of private repositories." Classic tokens
> have no read-only variant, so this is the minimum that lets the extension see
> private repos across orgs. The short expiry limits the exposure.

## 5. Configure the extension

1. Click the **Auto Groups** toolbar icon
2. **Store** tab → **Install** the GitHub adapter
3. **Installed** tab → paste your **token** → **Save Config**
   - Leave the host as `https://api.github.com` (only change it for GitHub Enterprise)
4. Click **Sync Now**

## What you'll see

A set of tab groups appears in your current window:

- **One group per repo** for PRs you authored (titled `owner/repo`)
- **`👀 Awaiting my review`** for PRs requesting your review
- PRs with no activity in the last **2 months** are skipped
- It auto-refreshes on the polling interval (default 5 min); adjust it in **Settings**.

## Troubleshooting

- **"Invalid GitHub token"** → token typo, expired, or (for org repos) not SSO-authorized.
- **A private/org repo's PRs are missing** → almost always the SSO authorization
  step (4.6) or a fine-grained token instead of classic.
- **Nothing happens** → make sure you clicked **Sync Now**, and that the adapter
  shows as installed + enabled.
