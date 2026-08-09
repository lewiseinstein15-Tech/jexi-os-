# 🚀 JEXI OS — Scaling Guide (vertical + horizontal, for $0)

This guide turns the ideas from the scaling video
(*"Horizontal scaling vs Vertical Scaling"*, @izziedevs) into JEXI OS — honestly
and for **free, no credit card**. Read this once to understand the plan, then
follow the setup steps.

---

## 1️⃣ What the video teaches (30-second version)

| Idea | What it means | JEXI's version |
|---|---|---|
| **Vertical scaling** | Make one server bigger (more RAM/CPU) | Render free caps at 512 MB — you can't buy more. We get the *same feel* by making the one server never sleep and do less wasted work |
| **Horizontal scaling** | Run several servers behind one address | A Cloudflare Worker balances requests across your servers with **health checks + failover** |
| **Load balancer** | The single address that picks which server answers | `deploy/lb-worker.js` — checks each server's `/api/health`, sends you to a healthy one, retries on another if one fails |
| **Health checks** | The balancer verifies a server is alive before using it | Each server's `/api/health` now reports its **instance id**, uptime, and Redis status |
| **Shared state** | All servers must remember the same things | JEXI's memory core already syncs to **Redis** on every write — plug in one free Upstash key and two servers behave like one brain |

---

## 2️⃣ What's already done (this repo)

| Piece | Where | Status |
|---|---|---|
| Keep-alive so Render never cold-starts (the ~1 min "slow" you feel) | `.github/workflows/keepalive.yml` — pings `/api/health` every 10 min | ✅ shipped, runs automatically |
| Load-balancer health endpoint (instance id + uptime + Redis) | `server/index.js` → `GET /api/health` | ✅ shipped |
| Memory already mirrors to Redis on every write (shared brain for N servers) | `server/src/services/MemoryManager.js` | ✅ shipped (just needs `REDIS_URL`) |
| Cloudflare Worker load balancer (probe, failover, IP stickiness, streaming chat pass-through, `/__lb/status`) | `deploy/lb-worker.js` | ✅ shipped, tested locally (see below) |

**Verified locally** with two simulated servers: health probe takes a sick server
out of rotation, a 5xx mid-request fails over to the other one, the same visitor
is always pinned to the same server (so the virtual desktop doesn't jump), and
chat streaming passes through untouched:

```
$ node deploy/test-lb.js
=== Load balancer tests ===
1) Both healthy        ✅ answered by a real origin
2) IP stickiness       ✅ same IP → same origin for all requests
3) Active health check ✅ probe reports A unhealthy, traffic to B
4) Passive failover    ✅ request failed over to A
5) Streaming pass-through ✅ both NDJSON lines arrive
6) /__lb/status        ✅ lists both origins
=== RESULT: 12 passed, 0 failed ===
```

---

## 3️⃣ The honest free-tier reality (read this part)

You asked for "multiple servers". Here's exactly what the free (no-card) hosting
world allows in 2026:

| Host | Free tier | Can it run a 2nd JEXI brain? |
|---|---|---|
| **Render** (current) | 1 web service, 750 h/month per account | ❌ A second always-on service blows the free hour cap |
| **Koyeb** | 1 free instance (512 MB), sleeps after 1 h idle | ❌ Only **one** free instance per account |
| **Hugging Face Spaces** | Free personal accounts: static/ZeroGPU only | ❌ Docker/Node Spaces need the paid PRO plan |
| **Cloudflare Workers** | 100k requests/day, **no card** | ✅ Used as the **load balancer** (not a brain) |
| **Upstash Redis** | 256 MB, 500k commands/month, **no card** | ✅ Shared memory so multiple brains agree |

**Bottom line:** one always-on brain server is free; a second always-on brain
server isn't (yet) — that's a hosting-industry rule, not a code problem. The
good news: **the balancer, health checks, and shared memory are all ready**, so
the moment you ever have a second host (or a friend's free Koyeb account, or a
paid $5 instance later), it's a 2-line config change — no code changes.

Until then, horizontal scaling's *other* big win is already yours: the
**keep-alive** (no cold starts) + **failover-ready** infrastructure.

---

## 4️⃣ Apply it yourself — step by step (all free)

### Step A — Turn on shared memory (5 min, recommended now)
1. Go to **upstash.com** → create a free Redis database (no card) → copy the `REDIS_URL` (starts with `rediss://…`).
2. Render dashboard → your **jexi-os-brain** service → **Environment** → add `REDIS_URL` → **Deploy**.
3. Done. JEXI's chat history, learned answers, and your book library now live in Redis — the foundation for multiple servers later.

### Step B — Deploy the load balancer (10 min, optional now)
1. **cloudflare.com** → sign up (free, no card) → enable the **Workers** free plan.
2. Two ways to deploy `deploy/lb-worker.js`:
   - **Dashboard:** Workers & Pages → Create → Worker → paste the whole file → Deploy.
   - **Terminal:** `npx wrangler@latest deploy deploy/lb-worker.js --name jexi-lb` (set `CLOUDFLARE_API_TOKEN` from the dashboard).
3. Your balancer URL looks like `https://jexi-lb.<your-subdomain>.workers.dev`.
4. Open `<balancer-url>/__lb/status` in a browser — you'll see `render-primary` listed **healthy**.
5. Point JEXI at the balancer: app → **Settings → Server** → paste the balancer URL. Every request now goes through the load balancer, and it health-checks Render constantly.

### Step C — Add a second server (only when you have one)
1. Get a second backend host running the same `server/` code (same env vars, **same `REDIS_URL`**).
2. Edit `ORIGINS` in `deploy/lb-worker.js` → add `{ name: 'host-two', url: 'https://…' }` → redeploy the worker (one line).
3. That's it — the balancer round-robins between the two, fails over if one dies, and both share JEXI's memory via Redis.

---

## 5️⃣ FAQ

**Will scaling make JEXI smarter?**
No — and nobody should sell you that. Scaling makes the app **faster and more
reliable** (no cold-start waits, no downtime when one server dies). JEXI's
intelligence comes from her Trusted Library + AI keys; those are unchanged.

**Why does she feel slow right now?**
Render free sleeps after ~15 idle minutes and takes ~1 min to wake (cold start).
The keep-alive workflow fixes exactly that — after it's been running a day,
check the workflow run history (Actions → "Keep JEXI Brain awake") to watch
every 10-minute ping succeed.

**Do I have to do anything for the keep-alive?**
No — it's a workflow in this repo; it starts running on its own after the next
push. (If you ever move the backend, update the URL in
`.github/workflows/keepalive.yml`.)

**Which config actually changed?**
`server/index.js` (health endpoint), `server/src/services/MemoryManager.js`
(Redis status export), `deploy/lb-worker.js` + `deploy/test-lb.js` (the balancer
and its tests), `.github/workflows/keepalive.yml` (the ping). No frontend change
needed — the app already lets you point at any backend URL from Settings.
