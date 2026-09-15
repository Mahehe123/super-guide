# Hiyo — Build Plan

Design: https://claude.ai/code/artifact/e50f2775-7679-4213-8a2b-3536e35599b7
Stack: Vite + TypeScript + Preact + Dexie (IndexedDB) + vite-plugin-pwa · light theme only · hi-iro red
Deploy: `Mahehe123/super-guide` → GitHub Pages at `mahehe123.github.io/super-guide/` (built by GitHub Actions)

Same site as Kira (`mahehe123.github.io`), so Hiyo can read Kira's saved data (`kira_data_v1` + receipts) right on the phone.
Kira's repo and app are **not touched**. Hiyo uses its own database name, so there's no clash with other apps on the same site.

## Phase 0 — Safety
- [x] 0.1 `git init` in this folder, remote = super-guide, `.gitignore` excludes `kira-backup.json` (personal data must never be pushed)
- [ ] 0.2 Before deploying, back up from Kira on the phone (Settings → Export JSON)

## Phase 1 — Foundation
- [x] 1.1 Scaffold Vite + TS + Preact in this folder (`base: '/super-guide/'`). Verify: `npm run dev` shows a blank app
- [x] 1.2 Design tokens + bundled fonts (Bricolage Grotesque, Figtree) + icon set. Verify: token preview renders
- [x] 1.3 App shell: 4-tab bottom nav, app bar, FAB, toast, dialog/sheet, Android back-button handling via history. Verify: tabs and back button work on a mobile viewport
- [x] 1.4 Data layer: Dexie schema (entries, categories with sub IDs, currencies, trips, recurring, budgets, receipts as Blob, settings, meta), `navigator.storage.persist()`. Verify: unit check that writes and reads round-trip

## Phase 2 — Migration from Kira
- [x] 2.1 Kira reader: `kira_data_v1` localStorage + Kira receipt IndexedDB, or an uploaded `kira-backup.json` (base64 receipts → Blob). Verify: parse the real backup → 383 entries, 17 categories, 6 currencies, 78 receipts
- [x] 2.2 Mapper: subcategory names → IDs, claim fields, SGD rate kept per entry, recurring entries → templates. Verify: totals per month match Kira exactly
- [x] 2.3 Import review screen: trip suggestions (split tags by date gaps, Holiday subcategories → trips), recurring suggestions, confirm. Verify: import the real backup in the browser

## Phase 3 — Core screens
- [x] 3.1 Add/Edit entry: amount-first, quick picks from history, category grid + sub chips, Personal/Work + Claimable, date, currency with auto FX, note, tags, trip, receipt (camera, compressed). Save / Save & next. Verify: add lunch in 2 taps
- [x] 3.2 Entries: day groups with totals, search (notes/tags/amount/category), filter chips, swipe-to-delete with Undo, month switcher. Verify against real data
- [x] 3.3 Home: net + expected income, spending pace vs last month, claims tile, bills-due tile, active trip, recent entries, backup reminder. Verify the numbers match the mockup
- [x] 3.4 Claims: cycle based on cutoff day, owed hero, pending/settled filters, multi-select → Settle (optionally create the income entry), receipt viewer, CSV + ZIP export (receipts), cutoff reminder. Verify: pending total matches Kira

## Phase 4 — Insights & planning
- [x] 4.1 Insights "Months": net-by-month bars, savings rate, averages, tap a bar → month detail
- [x] 4.2 Month detail: category breakdown with drill-down to entries, top subcategories, daily spending heatmap, rule-based insights (pace, unusual spends, category shifts)
- [x] 4.3 Trips: list + detail (total, category split, claim status, entries), auto-attach to the active trip by dates
- [x] 4.4 Recurring: templates (bills, loans, salary), due list, auto-create or confirm, expected income on Home
- [x] 4.5 Budgets: suggested from the 3-month average per category, progress on Month detail

## Phase 5 — Settings & data
- [x] 5.1 Categories/subcategories: add, rename, emoji, reorder (drag), archive instead of delete when used
- [x] 5.2 Currencies: add, default, refresh rates (fawazahmed0 currency API, same as Kira), manual rate
- [x] 5.3 Backup: export JSON (with/without receipts) via Android share sheet, restore, CSV export, CSV import, 7-day reminder, clear data (double-confirm)
- [x] 5.4 Preferences: claim cutoff day, reminders, receipt retention

## Phase 6 — Ship
- [x] 6.1 PWA: manifest, red icons (192/512/maskable), offline cache, update prompt. Verify: Lighthouse installable + works offline
- [x] 6.2 Accessibility & polish pass: labels, 48px touch targets, focus, reduced motion, empty states
- [x] 6.3 Deploy: GitHub Actions workflow builds and publishes to Pages (you set Settings → Pages → Source: GitHub Actions once). **Ask before pushing**
- [ ] 6.4 On the phone: open, auto-detect Kira data → import → install Hiyo
