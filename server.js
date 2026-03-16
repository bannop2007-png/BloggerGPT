import "dotenv/config";
import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 20);
const dataDir = path.join(process.cwd(), ".data");
const usageFile = path.join(dataDir, "usage.json");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadUsage() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(usageFile, "utf8"));
  } catch {
    return {};
  }
}

function saveUsage(data) {
  ensureDataDir();
  fs.writeFileSync(usageFile, JSON.stringify(data), "utf8");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function nextResetTime() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(24, 0, 0, 0);
  return reset;
}

app.use((req, res, next) => {
  if (req.path !== "/api/chat") return next();
  const ip = getClientIp(req);
  const key = `${todayKey()}:${ip}`;
  const usage = loadUsage();
  const count = usage[key] || 0;
  const resetAt = nextResetTime();
  const retryAfterSec = Math.max(0, Math.floor((resetAt.getTime() - Date.now()) / 1000));
  res.setHeader("X-RateLimit-Limit", DAILY_LIMIT);
  res.setHeader("X-RateLimit-Remaining", Math.max(DAILY_LIMIT - count, 0));
  res.setHeader("X-RateLimit-Reset", Math.floor(resetAt.getTime() / 1000));
  if (count >= DAILY_LIMIT) {
    return res.status(429).json({
      error: "rate_limit",
      detail: `Daily limit ${DAILY_LIMIT} reached`,
      reset_at: resetAt.toISOString(),
      retry_after_sec: retryAfterSec,
    });
  }
  usage[key] = count + 1;
  saveUsage(usage);
  next();
});

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
const openRouterModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o";
const openRouterFallbackModel = process.env.OPENROUTER_FALLBACK_MODEL || "";
const openRouterMaxTokens = Number(process.env.OPENROUTER_MAX_TOKENS || 256);

function extractContent(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return null;
  const content = msg.content;
  if (Array.isArray(content)) {
    const text = content.map((part) => part?.text || "").join("").trim();
    return text || null;
  }
  if (typeof content === "string") {
    const text = content.trim();
    return text || null;
  }
  return null;
}

async function openRouterRequest(model, messages) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      ...(process.env.OPENROUTER_SITE_URL
        ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
        : {}),
      ...(process.env.OPENROUTER_SITE_NAME
        ? {
            "X-Title": process.env.OPENROUTER_SITE_NAME,
            "X-OpenRouter-Title": process.env.OPENROUTER_SITE_NAME,
          }
        : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: openRouterMaxTokens,
    }),
  });

  const raw = await resp.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data, raw };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    useOpenRouter,
    model: useOpenRouter ? openRouterModel : "gpt-4.1-mini",
    fallbackModel: useOpenRouter ? openRouterFallbackModel : null,
    haveOpenAI: !!client,
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, model } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be array" });
    }
    // Примитивная защита от огромных base64 в запросе
    const payloadSize = JSON.stringify(messages).length;
    if (payloadSize > 300_000) {
      return res.status(413).json({ error: "payload_too_large", detail: "Image too large" });
    }
    const allowedModels = new Set([
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.1-8b-instruct",
    ]);
    const requestedModel = typeof model === "string" ? model : "";
    const modelToUse = allowedModels.has(requestedModel) ? requestedModel : openRouterModel;

    // --- OpenRouter path ---
    if (useOpenRouter) {
      const attempt1 = await openRouterRequest(modelToUse, messages);
      if (!attempt1.ok) {
        console.error("OpenRouter error", attempt1.status, attempt1.raw);
        return res
          .status(attempt1.status)
          .json({ error: "openrouter_error", detail: attempt1.raw });
      }

      let content = extractContent(attempt1.data);
      let usedModel = modelToUse;

      if (!content && openRouterFallbackModel && openRouterFallbackModel !== openRouterModel) {
        const attempt2 = await openRouterRequest(openRouterFallbackModel, messages);
        if (attempt2.ok) {
          const fallbackContent = extractContent(attempt2.data);
          if (fallbackContent) {
            content = fallbackContent;
            usedModel = openRouterFallbackModel;
          }
        } else {
          console.error("OpenRouter fallback error", attempt2.status, attempt2.raw);
        }
      }

      if (!content) {
        return res.status(502).json({
          error: "empty_reply",
          detail: JSON.stringify(attempt1.data || {}).slice(0, 400),
        });
      }

      return res.json({ reply: { role: "assistant", content }, meta: { model: usedModel } });
    }

    // --- OpenAI path ---
    if (!client) {
      return res
        .status(400)
        .json({ error: "missing_key", detail: "Set OPENAI_API_KEY or OPENROUTER_API_KEY" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.7,
      max_tokens: 256,
    });

    res.json({ reply: completion.choices[0].message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BloggerGPT proxy listening on ${PORT}, OpenRouter=${useOpenRouter}, model=${openRouterModel}`));
