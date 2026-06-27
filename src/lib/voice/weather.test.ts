import test from "node:test";
import assert from "node:assert/strict";
import {
  getWeather,
  describeWeatherCode,
  weatherReply,
  weatherNeedsLocationReply,
  type WeatherReport,
} from "./weather";

const GEO = {
  results: [
    {
      name: "San Francisco",
      latitude: 37.7749,
      longitude: -122.4194,
      admin1: "California",
      country_code: "US",
      timezone: "America/Los_Angeles",
    },
  ],
};

const FORECAST = {
  current: { temperature_2m: 61.2, weather_code: 3 },
  daily: {
    time: ["2026-06-27", "2026-06-28"],
    temperature_2m_max: [68, 72],
    temperature_2m_min: [54, 56],
    precipitation_probability_max: [60, 10],
    weather_code: [61, 1],
  },
};

function fakeFetch(geo: unknown = GEO, forecast: unknown = FORECAST) {
  const calls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    calls.push(url);
    if (url.includes("geocoding-api")) return geo;
    if (url.includes("/v1/forecast")) return forecast;
    throw new Error("unexpected url: " + url);
  };
  return { fetchJson, calls };
}

test("getWeather returns a deterministic today report from injected fetch", async () => {
  const { fetchJson, calls } = fakeFetch();
  const res = await getWeather("San Francisco, CA", "today", { fetchJson });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.report.location, "San Francisco");
  assert.equal(res.report.when, "today");
  assert.equal(res.report.tempNow, 61.2);
  assert.equal(res.report.high, 68);
  assert.equal(res.report.low, 54);
  assert.equal(res.report.precipChance, 60);
  assert.match(res.report.conditions, /overcast/i);
  // geocode first, forecast second — no secrets in URLs (keyless).
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls.join(" "), /api[_-]?key|token|secret/i);
});

test("getWeather tomorrow uses the second daily entry", async () => {
  const { fetchJson } = fakeFetch();
  const res = await getWeather("San Francisco", "tomorrow", { fetchJson });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.report.when, "tomorrow");
  assert.equal(res.report.high, 72);
  assert.equal(res.report.low, 56);
  assert.equal(res.report.precipChance, 10);
  assert.match(res.report.conditions, /clear/i);
  assert.equal(res.report.tempNow, undefined);
});

test("getWeather returns geocode_failed when the city is not found", async () => {
  const { fetchJson } = fakeFetch({ results: [] });
  const res = await getWeather("Nowheresville", "today", { fetchJson });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "geocode_failed");
});

test("getWeather returns fetch_failed when the forecast call throws", async () => {
  const fetchJson = async (url: string): Promise<unknown> => {
    if (url.includes("geocoding-api")) return GEO;
    throw new Error("network down");
  };
  const res = await getWeather("San Francisco", "today", { fetchJson });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "fetch_failed");
});

test("describeWeatherCode maps known WMO codes to plain English", () => {
  assert.match(describeWeatherCode(0), /clear/i);
  assert.match(describeWeatherCode(3), /overcast/i);
  assert.match(describeWeatherCode(61), /rain/i);
  assert.match(describeWeatherCode(71), /snow/i);
  assert.match(describeWeatherCode(95), /thunder/i);
});

test("weatherReply (today) speaks location, temp, conditions, rain, and an umbrella note", () => {
  const report: WeatherReport = {
    location: "San Francisco",
    when: "today",
    tempNow: 61,
    high: 68,
    low: 54,
    conditions: "Overcast",
    precipChance: 60,
    units: "fahrenheit",
  };
  const reply = weatherReply(report);
  assert.match(reply, /San Francisco/);
  assert.match(reply, /61/);
  assert.match(reply, /overcast/i);
  assert.match(reply, /high of 68/);
  assert.match(reply, /low of 54/);
  assert.match(reply, /60% chance of rain/);
  assert.match(reply, /umbrella/i);
});

test("weatherReply (tomorrow) uses forecast data and omits the umbrella note when dry", () => {
  const report: WeatherReport = {
    location: "San Francisco",
    when: "tomorrow",
    high: 72,
    low: 56,
    conditions: "Mainly clear",
    precipChance: 10,
    units: "fahrenheit",
  };
  const reply = weatherReply(report);
  assert.match(reply, /[Tt]omorrow/);
  assert.match(reply, /San Francisco/);
  assert.match(reply, /mainly clear/i);
  assert.match(reply, /72/);
  assert.match(reply, /56/);
  assert.match(reply, /10% chance of rain/);
  assert.doesNotMatch(reply, /umbrella/i);
});

test("weatherNeedsLocationReply points the operator to Settings -> Personalization or a city", () => {
  const reply = weatherNeedsLocationReply();
  assert.match(reply, /Settings/);
  assert.match(reply, /Personalization/);
  assert.match(reply, /city/i);
});
