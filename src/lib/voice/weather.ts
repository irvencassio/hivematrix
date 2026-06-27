/**
 * Weather data wrapper for the voice command layer. Deterministic + keyless:
 * uses Open-Meteo's free geocoding + forecast APIs (no API key, no secrets) so a
 * spoken "what's the weather today?" can be answered inline from the operator's
 * saved location (Settings → Personalization) without spawning a generic agent.
 *
 * The network fetch is injectable (`WeatherDeps.fetchJson`) so tests stay offline
 * and deterministic. External JSON is parsed defensively at the boundary. Nothing
 * here touches the operator's location source, the DB, or Claude/agent memory —
 * the caller (command-turn.ts) supplies the resolved location string.
 */

export type WeatherWhen = "today" | "tomorrow";

export interface WeatherReport {
  /** Resolved place name from geocoding, e.g. "San Francisco". */
  location: string;
  when: WeatherWhen;
  /** Current temperature — present for "today" only. */
  tempNow?: number;
  high?: number;
  low?: number;
  /** Plain-English conditions, e.g. "Overcast". */
  conditions: string;
  /** Max precipitation probability for the day, 0–100. */
  precipChance?: number;
  units: "fahrenheit" | "celsius";
}

export type WeatherResult =
  | { ok: true; report: WeatherReport }
  | { ok: false; error: "geocode_failed" | "fetch_failed" };

export interface WeatherDeps {
  /** Injectable JSON fetcher (default: global fetch). Tests pass a fake. */
  fetchJson?: (url: string) => Promise<unknown>;
  units?: "fahrenheit" | "celsius";
}

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`weather request failed: ${res.status}`);
  return (await res.json()) as unknown;
}

/** WMO weather interpretation code → concise plain-English description. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rainy";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 75) return "Snowy";
  if (code === 77) return "Snow grains";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorms";
  if (code === 96 || code === 99) return "Thunderstorms with hail";
  return "Unsettled";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function numAt(v: unknown, i: number): number | undefined {
  if (!Array.isArray(v)) return undefined;
  const n = v[i];
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

interface GeoHit { name: string; lat: number; lon: number }
type RankedGeoHit = GeoHit & { admin1?: string; countryCode?: string };

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

interface LocationQuery {
  search: string;
  state?: string;
  countryCode?: string;
}

function normalizeLocationQuery(location: string): LocationQuery[] {
  const raw = location.trim().replace(/\s+/g, " ");
  if (!raw) return [];
  const out: LocationQuery[] = [];
  const seen = new Set<string>();
  const add = (q: LocationQuery) => {
    const search = q.search.trim().replace(/\s+/g, " ");
    if (!search) return;
    const key = `${search.toLowerCase()}|${(q.state ?? "").toLowerCase()}|${q.countryCode ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...q, search });
    }
  };

  const comma = raw.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .]+)$/);
  if (comma) {
    const city = comma[1].trim();
    const suffix = comma[2].trim();
    const state = US_STATES[suffix.toUpperCase()] ?? suffix.replace(/\b\w/g, (c) => c.toUpperCase());
    add({ search: city, state, countryCode: "US" });
  }

  const trailing = raw.match(/^(.+?)\s+([A-Za-z]{2})$/);
  if (trailing && US_STATES[trailing[2].toUpperCase()]) {
    add({ search: trailing[1], state: US_STATES[trailing[2].toUpperCase()], countryCode: "US" });
  }

  add({ search: raw });
  return out;
}

function geoResults(payload: unknown, preference?: Omit<LocationQuery, "search">): RankedGeoHit[] {
  const root = asRecord(payload);
  const results = root?.results;
  if (!Array.isArray(results) || results.length === 0) return [];
  const hits = results.flatMap((item): RankedGeoHit[] => {
    const row = asRecord(item);
    if (!row) return [];
    const lat = num(row.latitude);
    const lon = num(row.longitude);
    if (lat === undefined || lon === undefined) return [];
    const name = typeof row.name === "string" && row.name ? row.name : "your area";
    const admin1 = typeof row.admin1 === "string" ? row.admin1 : "";
    const countryCode = typeof row.country_code === "string" ? row.country_code : "";
    return [{ name, lat, lon, admin1, countryCode }];
  });
  if (!preference?.state && !preference?.countryCode) return hits;
  const state = preference.state?.toLowerCase();
  const countryCode = preference.countryCode?.toUpperCase();
  return [...hits].sort((a, b) => scoreGeo(b, state, countryCode) - scoreGeo(a, state, countryCode));
}

function scoreGeo(hit: RankedGeoHit, state?: string, countryCode?: string): number {
  let score = 0;
  if (countryCode && hit.countryCode?.toUpperCase() === countryCode) score += 10;
  if (state && hit.admin1?.toLowerCase() === state) score += 20;
  return score;
}

function firstGeoResult(payload: unknown, preference?: Omit<LocationQuery, "search">): GeoHit | null {
  return geoResults(payload, preference)?.[0] ?? null;
}

function shapeReport(geo: GeoHit, payload: unknown, when: WeatherWhen, units: "fahrenheit" | "celsius"): WeatherReport {
  const root = asRecord(payload);
  const current = asRecord(root?.current);
  const daily = asRecord(root?.daily);
  const idx = when === "tomorrow" ? 1 : 0;

  const high = numAt(daily?.temperature_2m_max, idx);
  const low = numAt(daily?.temperature_2m_min, idx);
  const precipChance = numAt(daily?.precipitation_probability_max, idx);
  const dailyCode = numAt(daily?.weather_code, idx);

  if (when === "today") {
    const code = num(current?.weather_code) ?? dailyCode ?? 0;
    return {
      location: geo.name,
      when,
      tempNow: num(current?.temperature_2m),
      high,
      low,
      conditions: describeWeatherCode(code),
      precipChance,
      units,
    };
  }
  return {
    location: geo.name,
    when,
    high,
    low,
    conditions: describeWeatherCode(dailyCode ?? 0),
    precipChance,
    units,
  };
}

/**
 * Resolve `location` to a forecast. Geocodes the city string, then fetches the
 * current + 2-day daily forecast. Read-only, keyless, injectable fetch.
 */
export async function getWeather(location: string, when: WeatherWhen, deps: WeatherDeps = {}): Promise<WeatherResult> {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const units = deps.units ?? "fahrenheit";

  let geo: GeoHit | null = null;
  try {
    for (const query of normalizeLocationQuery(location)) {
      const count = query.state || query.countryCode ? 10 : 1;
      const geoUrl = `${GEOCODE_URL}?name=${encodeURIComponent(query.search)}&count=${count}&language=en&format=json`;
      geo = firstGeoResult(await fetchJson(geoUrl), query);
      if (geo) break;
    }
  } catch {
    return { ok: false, error: "geocode_failed" };
  }
  if (!geo) return { ok: false, error: "geocode_failed" };

  try {
    const tempUnit = units === "celsius" ? "celsius" : "fahrenheit";
    const fcUrl =
      `${FORECAST_URL}?latitude=${geo.lat}&longitude=${geo.lon}` +
      `&current=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=${tempUnit}&timezone=auto&forecast_days=2`;
    const report = shapeReport(geo, await fetchJson(fcUrl), when, units);
    return { ok: true, report };
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}

const unitWord = (units: WeatherReport["units"]) => (units === "celsius" ? "degrees Celsius" : "degrees");

/** Concise spoken weather answer for the voice command override. */
export function weatherReply(report: WeatherReport): string {
  const unit = unitWord(report.units);
  const cond = report.conditions.toLowerCase();

  if (report.when === "today") {
    const head = report.tempNow !== undefined
      ? `In ${report.location}, it's ${Math.round(report.tempNow)} ${unit} and ${cond}`
      : `In ${report.location}, it's ${cond}`;
    const range = report.high !== undefined && report.low !== undefined
      ? `, with a high of ${Math.round(report.high)} and a low of ${Math.round(report.low)}`
      : "";
    let s = `${head}${range}.`;
    if (report.precipChance !== undefined) {
      s += ` ${Math.round(report.precipChance)}% chance of rain.`;
      if (report.precipChance >= 50) s += " Umbrella likely.";
    }
    return s;
  }

  const range = report.high !== undefined && report.low !== undefined
    ? `, high ${Math.round(report.high)}, low ${Math.round(report.low)}`
    : "";
  let s = `Tomorrow in ${report.location}: ${cond}${range}.`;
  if (report.precipChance !== undefined) {
    s += ` ${Math.round(report.precipChance)}% chance of rain.`;
    if (report.precipChance >= 50) s += " Pack an umbrella.";
  }
  return s;
}

/** Spoken reply when no operator location is configured and none was spoken. */
export function weatherNeedsLocationReply(): string {
  return "I don't have your location saved. Set it in Settings, under Personalization, or tell me which city you're in.";
}
