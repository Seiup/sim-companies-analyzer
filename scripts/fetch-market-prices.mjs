import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_ROOT = "https://api.simcotools.com/v1/realms/0";
const outputPath = resolve(process.cwd(), process.argv[2] || "market-prices.json");
const resourcesPath = resolve(process.cwd(), "market-resources.json");
const refreshResources = process.argv.includes("--refresh-resources");

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function loadResources() {
  if (!refreshResources) {
    const saved = JSON.parse(await readFile(resourcesPath, "utf8"));
    if (!Array.isArray(saved.resources) || !saved.resources.length) throw new Error("market-resources.json does not contain resources.");
    return saved.resources;
  }

  const first = await getJson(`${API_ROOT}/resources`);
  const pages = Number(first.metadata?.lastPage) || 1;
  const resources = [...(first.resources || [])];
  for (let page = 2; page <= pages; page += 1) {
    const next = await getJson(`${API_ROOT}/resources?page=${page}`);
    resources.push(...(next.resources || []));
  }
  const unique = [...new Map(resources.filter((row) => Number.isFinite(Number(row.id)) && row.name).map((row) => [Number(row.id), { id: Number(row.id), name: String(row.name) }])).values()].sort((a, b) => a.id - b.id);
  if (!unique.length) throw new Error("The resource feed did not contain any usable resources.");
  await writeFile(resourcesPath, `${JSON.stringify({ schemaVersion: 1, retrievedAt: new Date().toISOString(), source: `${API_ROOT}/resources`, resources: unique }, null, 2)}\n`);
  console.log(`Saved ${unique.length} resource names to ${resourcesPath}.`);
  return unique;
}

const resources = await loadResources();
const resourceNames = new Map(resources.map((row) => [Number(row.id), row.name]));
const payload = await getJson(`${API_ROOT}/market/vwaps`);
const prices = (payload.vwaps || []).map((row) => {
  const resourceId = Number(row.resourceId), quality = Number(row.quality), price = Number(row.vwap), name = resourceNames.get(resourceId);
  return Number.isFinite(resourceId) && name && Number.isFinite(quality) && Number.isFinite(price) && price >= 0
    ? { resourceId, name, quality, price, observedAt: row.datetime || null }
    : null;
}).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name) || a.quality - b.quality);

if (!prices.length) throw new Error("The daily VWAP feed did not contain any usable prices.");
const snapshot = {
  schemaVersion: 1,
  source: "SimcoTools market VWAP",
  sourceUrl: `${API_ROOT}/market/vwaps`,
  priceType: "daily-vwap",
  retrievedAt: new Date().toISOString(),
  note: "Quality-specific daily market averages. This is not a live order-book quote.",
  prices
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${prices.length} daily market averages to ${outputPath}.`);
