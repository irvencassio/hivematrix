#!/usr/bin/env node
/**
 * AI news script generator for the avatar video pipeline.
 *
 * Default path is keyless: Hacker News Firebase top stories filtered for AI
 * terms. If NEWSAPI_KEY (or ~/.hivematrix/config.json newsapi.apiKey) exists,
 * --source auto can use NewsAPI. If ANTHROPIC_API_KEY (or config
 * providers.anthropic.apiKey) exists, --writer auto can ask Claude for the final
 * presenter script; otherwise a deterministic spoken script is generated.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(VIDEO_DIR, "out");
const CONFIG = join(homedir(), ".hivematrix", "config.json");
const HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM = "https://hacker-news.firebaseio.com/v0/item";
const NEWSAPI = "https://newsapi.org/v2/top-headlines";

export const AI_TITLE_RE = /\b(ai|a\.i\.|artificial intelligence|llm|llms|gpt|openai|anthropic|claude|gemini|qwen|mistral|llama|agent|agents|robotics|machine learning|neural|gpu|nvidia)\b/i;
const DEFAULT_TAGS = ["AI", "artificial intelligence", "AI news", "HiveMatrix"];

function config() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf-8"));
  } catch {
    return {};
  }
}

export function resolveNewsApiKey(env = process.env, cfg = config()) {
  return String(env.NEWSAPI_KEY || cfg?.newsapi?.apiKey || "").trim();
}

export function resolveAnthropicKey(env = process.env, cfg = config()) {
  return String(env.ANTHROPIC_API_KEY || cfg?.providers?.anthropic?.apiKey || "").trim();
}

function dayLabel(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildDefaultTitle(date = new Date()) {
  return `Top AI News - ${dayLabel(date)}`;
}

function cleanTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim();
}

export function selectAiHeadlines(stories, { limit = 3 } = {}) {
  return stories
    .filter((story) => AI_TITLE_RE.test(story.title || ""))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, limit);
}

export function buildDescription(stories, { title = buildDefaultTitle() } = {}) {
  const lines = [
    title,
    "",
    "Today's top AI stories, presented by HiveMatrix.",
    "",
    "Sources:",
  ];
  stories.forEach((story, i) => {
    lines.push(`${i + 1}. ${cleanTitle(story.title)} - ${story.url}`);
  });
  return `${lines.join("\n")}\n`;
}

export function buildTemplateScript(stories, { date = new Date() } = {}) {
  const chosen = stories.slice(0, 3);
  const names = chosen.map((story) => cleanTitle(story.title));
  const [first = "the latest wave of AI product updates", second = "new moves in open model tooling", third = "the infrastructure race behind modern AI"] = names;
  return [
    `Here are the top AI stories for ${dayLabel(date)}.`,
    `First, ${first}. This is worth watching because it shows where AI builders are putting real product pressure right now.`,
    `Second, ${second}. The practical takeaway is that the AI stack is still moving quickly, especially for developers and teams shipping new workflows.`,
    `Third, ${third}. Even when the headline sounds technical, the bigger story is capacity: faster tools, cheaper runs, and more room for useful agents.`,
    "That is the quick HiveMatrix AI news brief for today. Keep building, keep testing, and I will see you in the next update.",
  ].join(" ");
}

export function buildAnthropicPrompt(stories, { date = new Date(), brief = "" } = {}) {
  const sourceLines = stories
    .slice(0, 5)
    .map((story, i) => `${i + 1}. ${cleanTitle(story.title)} (${story.url})`)
    .join("\n");
  const direction = brief && brief.trim()
    ? `\n\nIMPORTANT — additional direction from the editor (follow it): ${brief.trim()}`
    : "";
  return `You are a friendly AI news presenter. Write a 90-second spoken script, about 220 words, covering the top 3 AI news stories for ${dayLabel(date)}. Use natural conversational language, no bullet points, no markdown, and end with a brief sign-off. Stories:\n\n${sourceLines}${direction}`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchHackerNewsStories({ sampleSize = 80 } = {}) {
  const ids = (await fetchJson(HN_TOP)).slice(0, sampleSize);
  const items = await Promise.all(ids.map(async (id) => {
    try {
      return await fetchJson(`${HN_ITEM}/${id}.json`);
    } catch {
      return null;
    }
  }));
  return items
    .filter((item) => item?.type === "story" && item.title)
    .map((item) => ({
      title: cleanTitle(item.title),
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      score: Number(item.score) || 0,
      source: "hacker-news",
    }));
}

async function fetchNewsApiStories(key) {
  const url = new URL(NEWSAPI);
  url.searchParams.set("q", "AI OR artificial intelligence OR OpenAI OR Claude");
  url.searchParams.set("language", "en");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("apiKey", key);
  const data = await fetchJson(url);
  return (data.articles || [])
    .filter((article) => article.title && article.url)
    .map((article, index) => ({
      title: cleanTitle(article.title),
      url: article.url,
      score: 1000 - index,
      source: article.source?.name || "newsapi",
    }));
}

async function fetchStories({ source = "auto" } = {}) {
  const newsApiKey = resolveNewsApiKey();
  if ((source === "auto" || source === "newsapi") && newsApiKey) {
    try {
      return await fetchNewsApiStories(newsApiKey);
    } catch (err) {
      if (source === "newsapi") throw err;
      console.error(`NewsAPI failed, falling back to Hacker News: ${err.message}`);
    }
  }
  return fetchHackerNewsStories();
}

// Write the script via an OpenAI-compatible endpoint supplied by the caller
// through HIVE_LLM_BASE_URL / HIVE_LLM_MODEL. HiveMatrix no longer runs a local
// inference server, so this is unset unless you stand one up yourself.
// Reads HIVE_LLM_* (fed in by the daemon when it spawns this script — see
// news-review.ts). Free + keyless; far better than the canned template.
function resolveLocalLlm() {
  const base = String(process.env.HIVE_LLM_BASE_URL || "").trim();
  const model = String(process.env.HIVE_LLM_MODEL || "").trim();
  if (!base || !model) return null;
  return { base: base.replace(/\/+$/, ""), model, key: String(process.env.HIVE_LLM_API_KEY || "local") };
}

async function writeLocalScript(stories, { llm, date, brief }) {
  const res = await fetch(`${llm.base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${llm.key}` },
    body: JSON.stringify({
      model: llm.model,
      max_tokens: 700,
      temperature: 0.6,
      messages: [{ role: "user", content: buildAnthropicPrompt(stories, { date, brief }) }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `local LLM HTTP ${res.status}`);
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function writeAnthropicScript(stories, { key, model, date, brief }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildAnthropicPrompt(stories, { date, brief }) }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`);
  return (data.content || [])
    .map((part) => part?.type === "text" ? part.text : "")
    .join("")
    .trim();
}

function parseArgs(argv) {
  const flag = (name, def = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
  };
  const has = (name) => argv.includes(name);
  return {
    source: flag("--source", "auto"),
    writer: flag("--writer", "auto"),
    brief: flag("--brief", ""),
    model: flag("--model", "claude-sonnet-4-6"),
    limit: Number(flag("--limit", "3")) || 3,
    date: new Date(flag("--date", new Date().toISOString())),
    scriptOut: flag("--script-out", join(OUT_DIR, "script.txt")),
    titleOut: flag("--title-out", join(OUT_DIR, "title.txt")),
    descriptionOut: flag("--description-out", join(OUT_DIR, "description.txt")),
    tagsOut: flag("--tags-out", join(OUT_DIR, "tags.txt")),
    headlinesOut: flag("--headlines-out", join(OUT_DIR, "headlines.json")),
    quiet: has("--quiet"),
  };
}

export async function generateNewsScript(options = {}) {
  const date = options.date || new Date();
  const stories = options.stories || await fetchStories({ source: options.source || "auto" });
  let selected = selectAiHeadlines(stories, { limit: options.limit || 3 });
  if (!selected.length) selected = stories.slice(0, options.limit || 3);
  const title = buildDefaultTitle(date);
  const description = buildDescription(selected, { title });
  const tags = DEFAULT_TAGS.join(",");

  // Writer selection (auto): real LLM first, canned template only as last resort.
  //   anthropic  → raw Anthropic API key (best, costs a little)
  //   local      → a self-hosted OpenAI-compatible endpoint via HIVE_LLM_* (none by default)
  //   template   → canned filler — fallback ONLY when no model is reachable
  let script;
  const writer = options.writer || "auto";
  const anthropicKey = resolveAnthropicKey();
  const localLlm = resolveLocalLlm();

  if (writer === "anthropic" || (writer === "auto" && anthropicKey)) {
    if (!anthropicKey) throw new Error("No Anthropic API key found for --writer anthropic.");
    try {
      script = await writeAnthropicScript(selected, { key: anthropicKey, model: options.model || "claude-sonnet-4-6", date, brief: options.brief || "" });
    } catch (err) {
      if (writer === "anthropic") throw err;
      console.error(`Anthropic writer failed, trying local model: ${err.message}`);
    }
  }
  if (!script && (writer === "local" || writer === "auto")) {
    if (!localLlm && writer === "local") throw new Error("No local model configured (HIVE_LLM_BASE_URL/HIVE_LLM_MODEL) for --writer local.");
    if (localLlm) {
      try {
        script = await writeLocalScript(selected, { llm: localLlm, date, brief: options.brief || "" });
      } catch (err) {
        console.error(`Local writer failed, falling back to template: ${err.message}`);
      }
    }
  }
  if (!script || script.length < 80) script = buildTemplateScript(selected, { date });
  return { title, description, tags, headlines: selected, script };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await generateNewsScript(opts);
  for (const path of [opts.scriptOut, opts.titleOut, opts.descriptionOut, opts.tagsOut, opts.headlinesOut]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(opts.scriptOut, `${result.script.trim()}\n`);
  writeFileSync(opts.titleOut, `${result.title}\n`);
  writeFileSync(opts.descriptionOut, result.description);
  writeFileSync(opts.tagsOut, `${result.tags}\n`);
  writeFileSync(opts.headlinesOut, `${JSON.stringify(result.headlines, null, 2)}\n`);
  if (!opts.quiet) {
    console.log(`script: ${opts.scriptOut}`);
    console.log(`title: ${opts.titleOut}`);
    console.log(`headlines: ${result.headlines.length}`);
  }
}

if (existsSync(fileURLToPath(import.meta.url)) && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

