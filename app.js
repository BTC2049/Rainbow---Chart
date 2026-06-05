const HISTORY_SOURCES = [
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max",
    parse: (data) =>
      (data?.prices || [])
        .map(([timestamp, price]) => ({ date: new Date(timestamp), price: Number(price) }))
        .filter(validPricePoint),
  },
  {
    name: "CryptoCompare",
    url: "https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&allData=true",
    parse: (data) =>
      (data?.Data?.Data || [])
        .map((item) => ({ date: new Date(item.time * 1000), price: Number(item.close) }))
        .filter(validPricePoint),
  },
  {
    name: "CoinCap",
    url: () => {
      const start = new Date("2013-04-28T00:00:00Z").getTime();
      return `https://api.coincap.io/v2/assets/bitcoin/history?interval=d1&start=${start}&end=${Date.now()}`;
    },
    parse: (data) =>
      (data?.data || [])
        .map((item) => ({ date: new Date(item.time), price: Number(item.priceUsd) }))
        .filter(validPricePoint),
  },
];

const SPOT_SOURCES = [
  {
    name: "Binance",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    parse: (data) => Number(data?.price),
  },
  {
    name: "Coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parse: (data) => Number(data?.data?.amount),
  },
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    parse: (data) => Number(data?.bitcoin?.usd),
  },
  {
    name: "CryptoCompare",
    url: "https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD",
    parse: (data) => Number(data?.USD),
  },
  {
    name: "CoinCap",
    url: "https://api.coincap.io/v2/assets/bitcoin",
    parse: (data) => Number(data?.data?.priceUsd),
  },
  {
    name: "Kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
    parse: (data) => Number((data?.result?.XXBTZUSD || data?.result?.XBTUSD)?.c?.[0]),
  },
];

const GENESIS = new Date("2009-01-03T00:00:00Z");
const FUTURE_END_YEAR = 2050;

const zones = [
  { name: "極度便宜", tone: "低溫區", sentiment: "極度恐慌", copy: "價格位於長期低估區，適合用長週期視角觀察分批累積機會。", color: "#3157a4" },
  { name: "便宜累積", tone: "偏低估", sentiment: "恐慌", copy: "估值仍偏低，長線買盤通常會開始留意這個區間。", color: "#2680bd" },
  { name: "低溫合理", tone: "偏舒適", sentiment: "謹慎", copy: "價格仍在相對舒服的位置，適合用長週期視角慢慢建立部位。", color: "#22a38a" },
  { name: "合理區", tone: "中性", sentiment: "中性", copy: "目前不算便宜也不算過熱，適合同時觀察趨勢、資金面與個人倉位。", color: "#8fbe41" },
  { name: "偏熱", tone: "偏樂觀", sentiment: "樂觀", copy: "市場開始升溫，追高前更需要確認自己的時間週期與風險承受度。", color: "#f0cf3d" },
  { name: "樂觀區", tone: "高溫區", sentiment: "貪婪", copy: "市場情緒明顯升溫，適合檢查槓桿、止盈與資金配置。", color: "#ee9a2f" },
  { name: "過熱區", tone: "偏高估", sentiment: "高度貪婪", copy: "估值已經偏高，市場情緒通常較熱，新增部位需要更謹慎。", color: "#e56135" },
  { name: "泡沫警戒", tone: "高風險", sentiment: "極度貪婪", copy: "價格進入高風險區，應優先考慮風險控制與倉位保護。", color: "#bd3242" },
  { name: "極度泡沫", tone: "極高風險", sentiment: "泡沫狂熱", copy: "價格非常過熱，任何新增部位都應該使用更嚴格的風險假設。", color: "#7a1f45" },
];

const multipliers = [0.26, 0.42, 0.64, 0.95, 1.38, 2.02, 2.96, 4.34, 6.36, 9.32];

const state = {
  allPrices: [],
  visiblePrices: [],
  bands: [],
  displayBands: [],
  futureBands: [],
  range: "all",
  latest: null,
  currentZone: null,
  priceSource: "",
  spotSource: "",
  bandModel: null,
  hoverPoint: null,
  hoverFrame: null,
  pendingHoverEvent: null,
  lastHoverKey: "",
  chartPoints: [],
  chartPlot: null,
  chartScales: null,
};

const els = {
  canvas: document.querySelector("#rainbowChart"),
  overlay: document.querySelector("#chartOverlay"),
  tooltip: document.querySelector("#chartTooltip"),
  loader: document.querySelector("#chartLoader"),
  legend: document.querySelector("#legend"),
  futureMood: document.querySelector("#futureMood"),
  spotPrice: document.querySelector("#spotPrice"),
  updatedAt: document.querySelector("#updatedAt"),
  zoneName: document.querySelector("#zoneName"),
  zoneCopy: document.querySelector("#zoneCopy"),
  zoneRange: document.querySelector("#zoneRange"),
  zoneTone: document.querySelector("#zoneTone"),
  needle: document.querySelector("#temperatureNeedle"),
  shareButton: document.querySelector("#shareButton"),
  refreshButton: document.querySelector("#refreshButton"),
  toast: document.querySelector("#toast"),
};

init();

function init() {
  renderLegend();
  wireEvents();
  loadPrices();
}

function wireEvents() {
  window.addEventListener("resize", drawChart);
  els.refreshButton.addEventListener("click", loadPrices);
  els.shareButton.addEventListener("click", copyShareText);
  els.overlay.addEventListener("mousemove", queueChartHover);
  els.overlay.addEventListener("mouseleave", clearChartHover);
  els.overlay.addEventListener("touchstart", handleChartTouch, { passive: true });
  els.overlay.addEventListener("touchmove", handleChartTouch, { passive: true });
  els.overlay.addEventListener("touchend", clearChartHover);
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-range]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.range = button.dataset.range;
      updateVisiblePrices();
      renderFutureMood();
      drawChart();
    });
  });
}

async function loadPrices() {
  setLoading(true);
  clearChartHover();
  const [historyResult, spotResult] = await Promise.all([fetchHistory(), fetchSpot()]);

  if (!historyResult?.prices?.length) {
    state.allPrices = [];
    state.visiblePrices = [];
    state.bands = [];
    state.displayBands = [];
    state.futureBands = [];
    state.bandModel = null;
    setUnavailable("目前無法取得真實歷史價格，請稍後再更新。");
    setLoading(false);
    drawChart();
    return;
  }

  state.priceSource = historyResult.source;
  state.spotSource = spotResult?.source || "";
  state.allPrices = historyResult.prices;
  if (spotResult?.price) applySpotToPrices(state.allPrices, spotResult.price);

  state.bandModel = fitRainbowModel(state.allPrices);
  state.bands = buildBandsForDates(state.allPrices.map((item) => item.date));
  state.futureBands = buildFutureBands();
  updateVisiblePrices();
  updateSignal();
  renderFutureMood();
  drawChart();
  setLoading(false);
}

async function fetchHistory() {
  const attempts = HISTORY_SOURCES.map((source) =>
    withTimeout(fetchJson(source.url), 9000).then((data) => {
      const prices = dedupePrices(source.parse(data));
      if (prices.length < 100) throw new Error("not enough history");
      return { source: source.name, prices };
    })
  );
  return Promise.any(attempts).catch(() => null);
}

async function fetchSpot() {
  const attempts = SPOT_SOURCES.map((source) =>
    withTimeout(fetchJson(source.url), 3200).then((data) => {
      const price = source.parse(data);
      if (!Number.isFinite(price) || price <= 0) throw new Error("bad spot");
      return { source: source.name, price };
    })
  );
  return Promise.any(attempts).catch(() => null);
}

async function fetchJson(urlOrFactory) {
  const url = typeof urlOrFactory === "function" ? urlOrFactory() : urlOrFactory;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("request failed");
  return response.json();
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function validPricePoint(item) {
  return item.date instanceof Date && !Number.isNaN(item.date.getTime()) && item.price > 0 && item.date >= new Date("2011-01-01T00:00:00Z");
}

function dedupePrices(prices) {
  const byDay = new Map();
  prices
    .filter(validPricePoint)
    .sort((a, b) => a.date - b.date)
    .forEach((item) => byDay.set(item.date.toISOString().slice(0, 10), item));
  return [...byDay.values()];
}

function applySpotToPrices(prices, spot) {
  const now = new Date();
  const latest = prices[prices.length - 1];
  if (sameUtcDay(latest.date, now)) {
    latest.date = now;
    latest.price = spot;
  } else {
    prices.push({ date: now, price: spot });
  }
}

function sameUtcDay(first, second) {
  return first.getUTCFullYear() === second.getUTCFullYear() && first.getUTCMonth() === second.getUTCMonth() && first.getUTCDate() === second.getUTCDate();
}

function fitRainbowModel(prices) {
  const samples = prices.map((item) => ({
    x: Math.log(daysSinceGenesis(item.date)),
    y: Math.log10(item.price),
  }));
  const avgX = average(samples.map((item) => item.x));
  const avgY = average(samples.map((item) => item.y));
  const slope =
    samples.reduce((sum, item) => sum + (item.x - avgX) * (item.y - avgY), 0) /
    samples.reduce((sum, item) => sum + (item.x - avgX) ** 2, 0);
  const intercept = avgY - slope * avgX;
  return { slope, intercept };
}

function buildBandsForDates(dates) {
  if (!state.bandModel) return [];
  return dates.map((date) => {
    const center = 10 ** (state.bandModel.intercept + state.bandModel.slope * Math.log(daysSinceGenesis(date)));
    return { date, values: multipliers.map((multiple) => center * multiple) };
  });
}

function buildFutureBands() {
  if (!state.allPrices.length || !state.bandModel) return [];
  const latest = state.allPrices[state.allPrices.length - 1].date;
  const dates = [];
  const cursor = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() + 1, 1));
  const end = new Date(Date.UTC(FUTURE_END_YEAR, 0, 1));
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 3);
  }
  return buildBandsForDates(dates);
}

function updateVisiblePrices() {
  if (!state.allPrices.length) {
    state.visiblePrices = [];
    state.displayBands = [];
    return;
  }

  if (state.range === "all") {
    state.visiblePrices = state.allPrices;
    state.displayBands = [...state.bands, ...state.futureBands];
    return;
  }

  const latestDate = state.allPrices[state.allPrices.length - 1].date;
  const cutoff = rangeCutoff(latestDate, state.range);
  state.visiblePrices = state.allPrices.filter((item) => item.date >= cutoff);
  if (state.visiblePrices.length < 2) state.visiblePrices = state.allPrices.slice(-2);
  const visibleKeys = new Set(state.visiblePrices.map((item) => item.date.getTime()));
  state.displayBands = state.bands.filter((band) => visibleKeys.has(band.date.getTime()));
}

function rangeCutoff(latestDate, range) {
  const cutoff = new Date(latestDate);
  const amount = Number(range.slice(0, -1));
  const unit = range.slice(-1);
  if (unit === "d") cutoff.setDate(cutoff.getDate() - amount);
  if (unit === "m") cutoff.setMonth(cutoff.getMonth() - amount);
  if (unit === "y") cutoff.setFullYear(cutoff.getFullYear() - amount);
  return cutoff;
}

function updateSignal() {
  const latest = state.allPrices[state.allPrices.length - 1];
  const latestBand = state.bands[state.bands.length - 1];
  if (!latest || !latestBand) return setUnavailable("目前無法取得真實行情資料，請稍後再按更新行情。");

  const zone = zoneForPrice(latest.price, latestBand.values);
  const zoneIndex = zones.indexOf(zone);
  state.latest = latest;
  state.currentZone = { ...zone, low: latestBand.values[zoneIndex], high: latestBand.values[zoneIndex + 1] };

  els.spotPrice.textContent = formatUsd(latest.price);
  els.updatedAt.textContent = latest.date.toLocaleDateString("zh-Hant", { month: "short", day: "numeric" });
  els.zoneName.textContent = zone.name;
  els.zoneName.style.color = zone.color;
  els.zoneCopy.textContent = zone.copy;
  els.zoneRange.textContent = state.currentZone.high ? `${formatUsd(state.currentZone.low)} - ${formatUsd(state.currentZone.high)}` : `高於 ${formatUsd(state.currentZone.low)}`;
  els.zoneTone.textContent = zone.tone;
  els.needle.style.left = `${(zoneIndex / (zones.length - 1)) * 100}%`;
}

function setUnavailable(message) {
  state.latest = null;
  state.currentZone = null;
  els.spotPrice.textContent = "行情暫不可用";
  els.updatedAt.textContent = "等待更新";
  els.zoneName.textContent = "行情暫不可用";
  els.zoneName.style.color = "";
  els.zoneCopy.textContent = message;
  els.zoneRange.textContent = "--";
  els.zoneTone.textContent = "等待資料";
  els.needle.style.left = "50%";
}

function drawChart() {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  els.overlay.width = canvas.width;
  els.overlay.height = canvas.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const overlayCtx = els.overlay.getContext("2d");
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCtx.clearRect(0, 0, rect.width, rect.height);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  if (!state.visiblePrices.length || !state.displayBands.length) {
    state.chartPoints = [];
    state.chartPlot = null;
    state.lastHoverKey = "";
    return;
  }

  const padding = { top: 26, right: 72, bottom: 48, left: 76 };
  const plot = { x: padding.left, y: padding.top, w: width - padding.left - padding.right, h: height - padding.top - padding.bottom };
  const yValues = [
    ...state.visiblePrices.map((item) => item.price),
    ...state.displayBands.flatMap((band) => band.values),
  ];
  const minY = Math.log10(Math.max(0.1, Math.min(...yValues) * 0.72));
  const maxY = Math.log10(Math.max(...yValues) * 1.16);
  const minX = state.displayBands[0].date.getTime();
  const maxX = state.displayBands[state.displayBands.length - 1].date.getTime();
  const xScale = (date) => plot.x + ((date.getTime() - minX) / (maxX - minX || 1)) * plot.w;
  const yScale = (price) => plot.y + (1 - (Math.log10(price) - minY) / (maxY - minY || 1)) * plot.h;
  const dateFromX = (x) => new Date(minX + ((x - plot.x) / plot.w) * (maxX - minX));
  const priceFromY = (y) => 10 ** (minY + (1 - (y - plot.y) / plot.h) * (maxY - minY));

  state.chartPlot = plot;
  state.chartScales = { xScale, yScale, dateFromX, priceFromY };
  state.chartPoints = state.visiblePrices.map((item) => {
    const band = nearestBand(item.date);
    return { type: "history", item, x: xScale(item.date), y: yScale(item.price), zone: zoneForPrice(item.price, band?.values || []) };
  });

  drawGrid(ctx, plot, minY, maxY, minX, maxX, yScale, xScale);
  drawBands(ctx, state.displayBands, xScale, yScale);
  if (state.range === "all") drawFutureDivider(ctx, plot, xScale);
  drawPrice(ctx, state.visiblePrices, xScale, yScale);
  drawLatestMarker(ctx, state.visiblePrices[state.visiblePrices.length - 1], xScale, yScale);
  ctx.strokeStyle = "rgba(17,24,39,0.16)";
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
  drawOverlay();
}

function drawGrid(ctx, plot, minY, maxY, minX, maxX, yScale, xScale) {
  ctx.save();
  ctx.strokeStyle = "rgba(98,112,134,0.18)";
  ctx.fillStyle = "#627086";
  ctx.font = "12px Microsoft JhengHei, sans-serif";

  const ticks = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000];
  ticks.forEach((tick) => {
    const logTick = Math.log10(tick);
    if (logTick < minY || logTick > maxY) return;
    const y = yScale(tick);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillText(formatUsd(tick), plot.x + plot.w + 10, y + 4);
  });

  const startYear = new Date(minX).getFullYear();
  const endYear = new Date(maxX).getFullYear();
  const step = endYear - startYear > 20 ? 5 : endYear - startYear > 8 ? 2 : 1;
  for (let year = startYear; year <= endYear; year += step) {
    const date = new Date(`${year}-01-01T00:00:00Z`);
    const x = xScale(date);
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.fillText(String(year), x - 14, plot.y + plot.h + 28);
  }
  ctx.restore();
}

function drawBands(ctx, bands, xScale, yScale) {
  for (let index = 0; index < zones.length; index += 1) {
    ctx.beginPath();
    bands.forEach((band, pointIndex) => {
      const x = xScale(band.date);
      const y = yScale(band.values[index + 1]);
      pointIndex ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    [...bands].reverse().forEach((band) => ctx.lineTo(xScale(band.date), yScale(band.values[index])));
    ctx.closePath();
    ctx.fillStyle = zones[index].color;
    ctx.globalAlpha = 0.82;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFutureDivider(ctx, plot, xScale) {
  const latest = state.allPrices[state.allPrices.length - 1];
  if (!latest) return;
  const x = xScale(latest.date);
  ctx.save();
  ctx.strokeStyle = "rgba(17,24,39,0.38)";
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(x, plot.y);
  ctx.lineTo(x, plot.y + plot.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#172033";
  ctx.font = "900 12px Microsoft JhengHei, sans-serif";
  ctx.fillText("未來模型區", x + 12, plot.y + 18);
  ctx.restore();
}

function drawPrice(ctx, prices, xScale, yScale) {
  ctx.save();
  drawSmoothPath(ctx, prices.map((item) => ({ x: xScale(item.date), y: yScale(item.price) })));
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = "#101827";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawLatestMarker(ctx, latest, xScale, yScale) {
  const x = xScale(latest.date);
  const y = yScale(latest.price);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#101827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101827";
  ctx.font = "800 13px Microsoft JhengHei, sans-serif";
  ctx.fillText(formatUsd(latest.price), Math.max(84, x - 84), y - 14);
  ctx.restore();
}

function renderLegend() {
  els.legend.innerHTML = zones.map((zone) => `<span><i style="background:${zone.color}"></i>${zone.name}</span>`).join("");
}

function renderFutureMood() {
  if (state.range !== "all" || !state.futureBands.length) {
    els.futureMood.classList.remove("show");
    els.futureMood.innerHTML = "";
    return;
  }
  const years = [2030, 2035, 2040, 2050];
  els.futureMood.innerHTML = years
    .map((year) => {
      const band = nearestBand(new Date(`${year}-01-01T00:00:00Z`), state.futureBands);
      const midIndex = 4;
      const low = band?.values[midIndex] || 0;
      const high = band?.values[midIndex + 1] || 0;
      const zone = zones[midIndex];
      return `<article style="--mood-color:${zone.color}"><small>${year} 模型中性區</small><strong>${formatUsd(low)} - ${formatUsd(high)}</strong><span>${zone.sentiment}</span></article>`;
    })
    .join("");
  els.futureMood.classList.add("show");
}

function handleChartTouch(event) {
  const touch = event.touches[0];
  if (touch) queueChartHover(touch);
}

function queueChartHover(event) {
  state.pendingHoverEvent = { clientX: event.clientX, clientY: event.clientY };
  if (state.hoverFrame) return;
  state.hoverFrame = window.requestAnimationFrame(() => {
    state.hoverFrame = null;
    handleChartHover(state.pendingHoverEvent);
  });
}

function handleChartHover(event) {
  if (!state.chartPlot || !state.chartScales) return;
  const rect = els.overlay.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const plot = state.chartPlot;
  if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return clearChartHover();

  const latest = state.allPrices[state.allPrices.length - 1];
  const hoverDate = state.chartScales.dateFromX(x);
  if (state.range === "all" && latest && hoverDate > latest.date) {
    const price = state.chartScales.priceFromY(y);
    const band = nearestBand(hoverDate, state.displayBands);
    const zone = zoneForPrice(price, band?.values || []);
    state.hoverPoint = { type: "future", item: { date: hoverDate, price }, x, y, zone };
  } else {
    state.hoverPoint = nearestPoint(x);
  }
  const hoverKey = `${state.hoverPoint.type}-${Math.round(state.hoverPoint.x)}-${Math.round(state.hoverPoint.y)}-${state.hoverPoint.zone.name}`;
  if (hoverKey === state.lastHoverKey) return;
  state.lastHoverKey = hoverKey;
  positionTooltip(state.hoverPoint, rect);
  drawOverlay();
}

function clearChartHover() {
  state.hoverPoint = null;
  state.lastHoverKey = "";
  els.tooltip.classList.remove("show");
  els.tooltip.setAttribute("aria-hidden", "true");
  clearOverlay();
}

function nearestPoint(x) {
  let nearest = state.chartPoints[0];
  let nearestDistance = Math.abs(x - nearest.x);
  for (const point of state.chartPoints) {
    const distance = Math.abs(x - point.x);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function nearestBand(date, bands = state.bands) {
  if (!bands.length) return null;
  let nearest = bands[0];
  let distance = Math.abs(date - nearest.date);
  for (const band of bands) {
    const nextDistance = Math.abs(date - band.date);
    if (nextDistance < distance) {
      nearest = band;
      distance = nextDistance;
    }
  }
  return nearest;
}

function positionTooltip(point, rect) {
  if (!point) return;
  const shellRect = els.canvas.parentElement.getBoundingClientRect();
  const left = Math.min(Math.max(point.x, 108), rect.width - 108);
  const top = Math.max(point.y, 104);
  els.tooltip.style.left = `${left + rect.left - shellRect.left}px`;
  els.tooltip.style.top = `${top + rect.top - shellRect.top}px`;
  els.tooltip.style.setProperty("--tooltip-color", point.zone.color);
  const label = point.type === "future" ? "模型價位" : "歷史價格";
  els.tooltip.innerHTML = `
    <strong>${formatUsd(point.item.price)}</strong>
    <span>${point.item.date.toLocaleDateString("zh-Hant", { year: "numeric", month: "short", day: "numeric" })}</span>
    <span>${label}・區間：${point.zone.name}</span>
    <small>情緒：${point.zone.sentiment}</small>
  `;
  els.tooltip.classList.add("show");
  els.tooltip.setAttribute("aria-hidden", "false");
}

function drawHover(ctx, point, plot) {
  if (!point) return;
  ctx.save();
  ctx.strokeStyle = point.type === "future" ? "rgba(156,255,56,0.7)" : "rgba(17,24,39,0.32)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(point.x, plot.y);
  ctx.lineTo(point.x, plot.y + plot.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = point.zone.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, point.type === "future" ? 7 : 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawOverlay() {
  const rect = els.overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const ctx = els.overlay.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawHover(ctx, state.hoverPoint, state.chartPlot);
}

function clearOverlay() {
  const rect = els.overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const ctx = els.overlay.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function drawSmoothPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function zoneForPrice(price, values = []) {
  const cutoffIndex = values.findIndex((value) => price < value);
  const index = cutoffIndex === -1 ? zones.length - 1 : Math.max(0, Math.min(zones.length - 1, cutoffIndex - 1));
  return zones[index];
}

async function copyShareText() {
  const zone = state.currentZone;
  const latest = state.latest;
  if (!zone || !latest) return showToast("行情還在載入中。");
  const text = `BTC 彩虹圖今日溫度：${zone.name}\n現貨：約 ${formatUsd(latest.price)}\n情緒：${zone.sentiment}\n資料來源：${state.priceSource}${state.spotSource ? ` / ${state.spotSource}` : ""}\n\n${zone.copy}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("今日訊號已複製。");
  } catch (error) {
    showToast("瀏覽器不支援自動複製，請手動複製頁面內容。");
  }
}

function daysSinceGenesis(date) {
  return Math.max(1, (date - GENESIS) / 86400000);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function setLoading(isLoading) {
  if (isLoading) {
    els.loader.textContent = "正在載入 BTC 真實歷史價格...";
    els.loader.classList.remove("hidden");
  } else if (state.allPrices.length) {
    els.loader.classList.add("hidden");
  }
  els.refreshButton.disabled = isLoading;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3000);
}
