# 🖥 Self-Host JEXI OS Brain — your own always-on server

The Render **free tier hibernates after ~15 min of inactivity** — the first request
after idle takes 30–90 s to cold-start (feels exactly like "the server is stuck").
A dedicated single-user VPS fixes that completely: **no hibernation, no cold
starts, 24/7, auto-restart on crash, and 2 GB+ RAM so the browser/QA agents never
OOM-kill the process.**

| | Render Free (current) | $4–6/mo VPS (this guide) |
|---|---|---|
| First request after idle | **30–90 s cold start** ❌ | < 100 ms ✅ |
| Sleeps after 15 min idle | ❌ yes (hibernates) | ✅ never |
| Crash recovery | restarts, but slowly | **systemd restarts in ~3 s** ✅ |
| RAM | ~512 MB (Chromium OOM risk) | 2 GB+ (no OOM) ✅ |
| Persistent memory | wiped on redeploy (unless paid disk) | **lives in `/var/lib/jexi-os`, never wiped** ✅ |
| Cost | $0 | ~$4–6/mo |
| Your AI keys | Render env | `/etc/jexi-os.env` |

**Speed win:** responses are not "faster per token" — they're *consistently instant*
because there is never a cold start, and the CPU is not throttled/shared with other
free users.

---

## Option A — cheap VPS (recommended, ~10 min)

Pick any provider with a **Debian/Ubuntu** image (all have a $4–6 tier):

- **Hetzner** CX22 — €3.79/mo (2 vCPU, 4 GB RAM) — best value
- **DigitalOcean** Basic $6/mo (1 vCPU, 1 GB RAM) — easiest UI
- **Linode/Akamai** Shared 1 GB — $5/mo
- **Oracle Cloud** Always Free — $0 (2 vCPU, 1 GB, needs a credit card)

Then run the one-command installer as root:

```bash
bash setup-vps.sh
```

The installer clones the repo, installs Node 22 + Chromium, creates a `jexi` user,
writes `/etc/jexi-os.env`, and registers a **systemd unit with `Restart=always`** —
if the process ever dies, it comes back in ~3 seconds, no human needed.

Then put your keys in `/etc/jexi-os.env` and restart:

```bash
sudo nano /etc/jexi-os.env   # add GROQ_API_KEY / GEMINI_API_KEY / JEXI_API_KEY / CORS_ORIGINS
sudo systemctl restart jexi-os-brain
```

### Point your app at it

The frontend already runs free on **GitHub Pages** — just set the backend URL:

```bash
# in the repo, then push (the Pages workflow bakes it in):
# VITE_JEXI_BACKEND_URL=https://YOUR_VPS_IP:3002
```

Or in Settings → JEXI ACCESS KEY paste the same `JEXI_API_KEY` if you locked the API.

### Optional: HTTPS + nice domain (5 extra min, recommended)

Install Caddy (auto-HTTPS, one binary):

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

Then `/etc/caddy/Caddyfile`:

```
api.yourdomain.com {
    reverse_proxy 127.0.0.1:3002
}
```

And set `CORS_ORIGINS=https://lewiseinstein15-Tech.github.io` in `/etc/jexi-os.env`.
Now your backend is `https://api.yourdomain.com` with a real certificate, no ports.

---

## Option B — keep Render but stop the hibernation

Simplest possible change: Render's **Starter plan ($7/mo)** doesn't hibernate.
Everything else (deploys, env vars, health checks) stays identical.

---

## Option C — your own machine (free, but not always-on)

An old laptop/PC at home running the same `setup-vps.sh` works — but the service
only answers when that machine is powered and online. Add **Cloudflare Tunnel**
(free) if you want a public URL without port-forwarding. Fine for experiments,
not for "runs in the background well without restarting".

---

## What I also hardened in this release

- **LLM timeouts** — every Groq/Gemini call now caps at 90 s (previously *no
  timeout at all*: a hung provider stalled the chat forever).
- **15-min chat deadline** — a pathological task can no longer hold the
  connection open indefinitely; you get a readable "ask me to continue" instead
  of a permanent spinner.
- **Persistent data** — memory/knowledge live in `/var/lib/jexi-os`, never wiped
  by redeploys (Render free tier wipes `server/data` on every redeploy).
