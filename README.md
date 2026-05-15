# Research Agent — Telegram Bot on Vercel (Free)

A Telegram bot that takes a research title, asks clarifying questions, performs live web research, and replies with a `.docx` Word report.

**Stack (all free tiers):**
- **Vercel Hobby** — serverless hosting
- **Google Gemini API** — LLM + Google Search grounding (free tier)
- **Upstash Redis** — persistent session state (free tier)
- **Telegram Bot API** — chat interface (free)
- **`docx`** — generates `.docx` files

> ⚠️ Claude Pro (chat subscription) does **not** include API access — that's why we use Gemini's free API tier instead.

---

## 1. Create the Telegram Bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow prompts
3. Copy the **bot token** (looks like `123456:ABC-DEF...`)

## 2. Get a Gemini API key (free)

1. Go to <https://aistudio.google.com/apikey>
2. Sign in with Google → **Create API key**
3. Copy it

## 3. Create an Upstash Redis database (free)

1. Go to <https://console.upstash.com/>
2. Sign in (GitHub/Google) → **Create Database** → Redis → Free tier
3. From the database page, copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 4. Deploy to Vercel

```bash
npm install
npm install -g vercel
vercel login
vercel link       # create a new project
vercel --prod     # first deploy
```

Add environment variables (Vercel dashboard → Project → Settings → Environment Variables), or via CLI:

```bash
vercel env add TELEGRAM_BOT_TOKEN
vercel env add GEMINI_API_KEY
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel --prod    # redeploy so env vars take effect
```

Note your deployment URL, e.g. `https://research-agent-xyz.vercel.app`

## 5. Register the Telegram webhook (one-time)

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"<YOUR_VERCEL_URL>/api/telegram"}'
```

Verify:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## 6. Use it

1. Open your bot in Telegram, send `/start`
2. Send a topic, e.g. `Effects of intermittent fasting on metabolism`
3. The bot replies with 3–5 clarifying questions
4. Reply with your answers in **one message** (or write `any` to skip)
5. Wait ~30–60 seconds → receive a `.docx` report as a reply 🎉

Commands: `/start`, `/help`, `/cancel`

---

## How it works

```
Telegram → POST /api/telegram (Vercel function)
   ├─ /start          → reset session in Upstash
   ├─ topic message   → Gemini generates clarifying questions → stored in Upstash
   ├─ answers message → Gemini researches with Google Search grounding
   │                  → markdown report → converted to .docx
   │                  → sent back as document reply
   └─ session cleared
```

State lives in Upstash because Vercel serverless functions are stateless between invocations.

## Free-tier limits

| Service    | Free tier                                  |
|------------|--------------------------------------------|
| Vercel     | 100 GB-hours/mo, 60s max function duration |
| Gemini API | 15 req/min, 1500 req/day (Flash model)     |
| Upstash    | 10k commands/day, 256 MB                   |
| Telegram   | Unlimited                                  |

Plenty for personal use.

## Local dev (optional)

```bash
cp .env.example .env.local   # fill values
vercel dev
```

Use [ngrok](https://ngrok.com/) to expose `localhost:3000` and point the webhook there for testing.

## Troubleshooting

- **Bot doesn't respond:** run `getWebhookInfo` — `last_error_message` will show issues. Confirm env vars are set in Vercel and you redeployed after adding them.
- **"Function timed out":** Gemini research is occasionally slow. The function is capped at 60s on Hobby tier. Try a more specific topic.
- **Garbled doc:** check Vercel function logs.

## File layout

```
api/telegram.ts     # Vercel serverless webhook handler
lib/telegram.ts     # Telegram Bot API helpers (sendMessage, sendDocument)
lib/state.ts        # Upstash Redis session store
lib/research.ts     # Gemini: clarifying questions + grounded research
lib/docx.ts         # Markdown → .docx converter
```
