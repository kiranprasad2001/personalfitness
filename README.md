# Fit Tracker (PWA)

A static, installable web app. No server, no accounts, no build step.
All data stays in the browser on each phone (localStorage).

## Host it (pick one)

**GitHub Pages**
1. Create a repository and upload everything in this folder (keep the folder structure).
2. Repository Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/` on each phone.

**Netlify / Cloudflare Pages**: drag this folder onto the dashboard.

**Your own domain**: copy the folder to any static host. It must be served over HTTPS
(a requirement for installing and for offline use). It works from a sub-path.

## Install on the phones
- iPhone (Safari): Share > Add to Home Screen.
- Android (Chrome): menu > Install app / Add to Home screen.
- First launch: enter a name, pick Plan A or Plan B, set the start date.

## Files
- `index.html`, `styles.css`, `app.js`: the app.
- `data.js`: both training plans, meal plans, food library and video ids. Edit plans here.
- `sw.js`: offline cache. **Change the `CACHE` version string whenever you change any file**,
  otherwise phones keep the old copy.
- `vendor/exceljs.min.js`: ExcelJS 4.4.0 (MIT), used for the Excel export.

## Data
- More > Export to Excel: same sheets as the spreadsheet tracker (values, not formulas).
- More > Save backup / Restore backup: a JSON file with everything. Use it to move phones.
- Clearing the browser's site data erases the log. Installed (home screen) apps are not
  cleared automatically by iOS, plain Safari tabs can be after weeks of no use. Back up now and then.

## Videos
Each exercise has a default YouTube video (embedded, needs a connection) plus
"Find other videos". Any link can be replaced per exercise inside the app.
