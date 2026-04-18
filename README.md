# MLB 13-Run Pool Tracker

Auto-updating MLB run pool tracker. Polls the MLB Stats API every 60 seconds via a Vercel serverless proxy.

## Project Structure

```
mlb-pool/
├── api/
│   └── scores.js        ← Vercel serverless proxy (calls statsapi.mlb.com server-side)
├── src/
│   ├── main.jsx         ← React entry point
│   └── App.jsx          ← Main app (calls /api/scores)
├── public/
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## Deploy to Vercel (one-time setup)

### Option A — GitHub + Vercel dashboard (recommended)

1. Push this folder to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "initial"
   gh repo create mlb-pool --public --push
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo

3. Vercel auto-detects Vite. Set:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

4. Click **Deploy**. Done. You'll get a URL like `mlb-pool.vercel.app`.

### Option B — Vercel CLI

```bash
npm install -g vercel
cd mlb-pool
npm install
vercel --prod
```

## Local Development

```bash
npm install

# Terminal 1 — Vercel dev server (runs both API and Vite)
npx vercel dev

# App will be at http://localhost:3000
```

> `vercel dev` is important — it runs the `/api/scores.js` function locally so
> the proxy works. Plain `npm run dev` alone won't serve the API routes.

## How It Works

- The browser calls `/api/scores?date=YYYY-MM-DD` every 60 seconds
- `api/scores.js` runs on Vercel's servers, calls `statsapi.mlb.com`, and returns
  clean JSON with `finals` and `live` game data
- The React app merges new final scores into the pool state and flashes alerts

## Future Enhancements

- **Persistent storage**: Replace `INITIAL_SCORES` with a database (Vercel KV, PlanetScale, Supabase)
  so scores survive page refreshes and multiple viewers stay in sync
- **Real-time push**: Replace polling with Vercel SSE or Pusher for true real-time updates
- **Admin auth**: Add a simple password gate on the Manual Entry tab
