# Tornado Web Dashboard

Live web version of the Tornado options trading portfolio. Glassmorphism dark UI. Works on any device with a browser.

## Live Site

https://mikepowell.github.io/tornado-dash/

## Setup

### 1. Get a free Finnhub API key (for stock prices)

1. Go to https://finnhub.io/register
2. Sign up (free, no credit card, works from Canada)
3. Copy your API key from the dashboard

### 2. Configure the dashboard

Open `index.html` and update the config at the top:

```javascript
const CONFIG = {
    sheetId: '1G2TBfd_XX3oFKu_KVKJmhVsgt_Os82DqheNFqWzHlZ0',
    finnhubKey: 'YOUR_API_KEY_HERE',  // paste from finnhub.io
    refreshSeconds: 30
};
```

### 3. Deploy

**Option A: GitHub Pages (free)**
```bash
# Create a repo called tornado-dash, then:
git init
git add index.html
git commit -m "Tornado web dashboard v1"
git remote add origin https://github.com/YOUR_USERNAME/tornado-dash.git
git push -u origin main
```
Then enable Pages in repo Settings → Pages → deploy from main branch.

**Option B: Any static host**
Drop `index.html` on Netlify, Vercel, S3, or just open locally in a browser.

## Data Sources

| Data | Source | Update |
|------|--------|--------|
| Positions | Google Sheets CSV | On load + refresh |
| Stock prices | Finnhub API | On load + refresh |
| Signals (Skim Quick) | Google Sheets CSV | On load + refresh |
| Price Tracker | Finnhub API | On load + refresh |

## Files

- `index.html` — single-page app (CSS + JS inline)
- `README.md` — this file
