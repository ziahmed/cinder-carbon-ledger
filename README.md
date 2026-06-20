# Cinder — a personal carbon ledger

A web app that tracks individual environmental impact and turns it into **actionable, annualized insights**. Your daily footprint is framed as a budget you draw down; log activity across transport, home energy, food, and goods, and Cinder ranks your biggest realistic ways to cut — each with the CO₂e you'd save per year.

## Submission links

- **Source Code URL:** _replace with your repo, e.g._ `https://github.com/ziahmed/cinder-carbon-ledger`
- **Live Application URL:** _replace with your deployment, e.g._ `https://cinder-carbon-ledger.vercel.app`

## Features

- **Today** — a budget gauge (today's CO₂e vs your daily target), a 7-day trend with a target line, a category breakdown, and a deletable ledger.
- **Log** — fast logging across Transport, Home energy, Food, and Things, with a live CO₂e estimate before you save. Backdating supported.
- **Insights** — reads *your* data, ranks your biggest levers by yearly impact (e.g. swapping red-meat meals, shifting short car trips), benchmarks your daily average against the ~5.5 kg/day sustainable target, and credits what you already do well.
- **Settings** — adjustable daily budget, optional name, clear-data option.
- Data persists in the browser via `localStorage`. Nothing is sent anywhere.

## Tech

React 18 + Vite, [recharts](https://recharts.org) for charts, [lucide-react](https://lucide.dev) for icons. No backend.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build
```

## Deploy (pick one)

### Vercel (easiest)
1. Push this repo to GitHub.
2. Go to vercel.com → New Project → import the repo.
3. Framework preset auto-detects **Vite**. Click Deploy. Done — that URL is your Live Application URL.

### Netlify
1. Push to GitHub.
2. netlify.com → Add new site → Import from Git → pick the repo.
3. Build command `npm run build`, publish directory `dist`. Deploy.

### GitHub Pages
1. In `vite.config.js`, uncomment `base` and set it to `"/<your-repo-name>/"`.
2. `npm run build`, then publish the `dist/` folder to the `gh-pages` branch (e.g. with the `gh-pages` package or an Actions workflow).

## A note on the numbers

Estimates use published average emission factors (DEFRA / EPA / Our World in Data style). They're directional for personal awareness, not a certified inventory — grid electricity intensity in particular varies a lot by country. The default electricity factor is a moderate global value (0.41 kg CO₂e/kWh).
