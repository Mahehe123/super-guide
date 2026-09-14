# Hiyo

Personal expense manager for Android, installed from the browser. Expenses, income, claims, trips, recurring bills and budgets. All data stays on the phone (IndexedDB).

**App:** https://mahehe123.github.io/super-guide/

## Install on Android
1. Open the link in Chrome.
2. ⋮ menu → **Install app** (or **Add to Home screen**).
3. First launch: **Import from Kira** brings over entries, receipts, claims and categories from Kira on the same phone.

## Backups
Data never leaves the phone on its own. Use **Settings → Back up now** and pick Google Drive or Files in the share sheet. Home reminds you after 7 days.

## Develop
```bash
npm install
npm run dev        # http://localhost:5178/super-guide/
npm test
npm run build
```

Pushing to `main` builds and deploys through GitHub Actions (Settings → Pages → Source: **GitHub Actions**).

Never commit backup files — `*backup*.json` is git-ignored because it holds personal finance data.
