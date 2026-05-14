// ─── CONFIG ───────────────────────────────────────────────
const SHEET_ID = '1G2TBfd_XX3oFKu_KVKJmhVsgt_Os82DqheNFqWzHlZ0';
const CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv';
const REFRESH_MS = 30000;

// Colors per bucket
const BUCKET_COLORS = {
  'Foundation LEAP': '#0055ff', 'Foundation': '#0055ff', 'Foundation BX': '#0055ff',
  'Ladder': '#6655ff', 'Rotation': '#00aa88', 'Skim': '#00c853',
  'Lottery': '#ff8822', 'Hedge': '#ff4444', 'Wallet': '#aaaaff'
};
const BUCKET_ORDER = ['Foundation LEAP','Foundation','Foundation BX','Ladder','Rotation','Skim','Lottery','Hedge','Wallet'];

// ─── STATE ────────────────────────────────────────────────
var positions = [];
var stockPrices = {};
var signals = [];
var buckets = [];
var finnhubKey = localStorage.getItem('finnhubKey') || '';
var refreshTimer = null;

// ─── UTILITY ──────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmt(n) { return '$' + Number(n).toFixed(2); }
function fmtCompact(n) { return Number(n).toLocaleString('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}); }
function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
function esc(s) { return String(s).replace(/"/g,'').trim(); }
function nowStr() { var d=new Date(); return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}); }
function moneyness(stock, strike, optType) {
  if (!stock || !strike) return {label:'--',cls:''};
  var diff = optType === 'P' ? strike - stock : stock - strike;
  if (diff > 0.5) return {label:'ITM',cls:'moneyness-itm'};
  if (diff > -0.5) return {label:'ATM',cls:'moneyness-atm'};
  return {label:'OTM',cls:'moneyness-otm'};
}

function parseDollar(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[$,]/g,'')) || 0;
}

function parseCSV(text) {
  var lines = text.split('\n').filter(function(l) { return l.trim(); });
  if (lines.length < 2) return [];
  var result = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = [];
    var cur = '', inQuote = false;
    for (var j = 0; j < lines[i].length; j++) {
      var ch = lines[i][j];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    result.push(vals);
  }
  return result;
}

function getBucketColor(b) {
  return BUCKET_COLORS[b] || '#888';
}

// ─── GOOGLE SHEETS FETCH ─────────────────────────────────
function fetchSheetCSV(sheetName) {
  return fetch(CSV_URL + '&sheet=' + encodeURIComponent(sheetName) + '&_cb=' + Date.now(), { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .catch(function(e) {
      console.warn('Sheet fetch failed for ' + sheetName + ':', e);
      return '';
    });
}

// ─── FINNHUB PRICE FETCH ──────────────────────────────────
function fetchFinnhubPrice(ticker) {
  if (!finnhubKey) return Promise.resolve(null);
  return fetch('https://finnhub.io/api/v1/quote?symbol=' + ticker + '&token=' + finnhubKey, { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) return null;
      return r.json();
    })
    .then(function(d) {
      if (!d || d.c === undefined || d.c === 0) return null;
      return {
        ticker: ticker, currentPrice: d.c,
        change: d.d || 0,
        changePercent: d.dp || 0,
        high: d.h, low: d.l, open: d.o, prevClose: d.pc
      };
    })
    .catch(function() { return null; });
}

function fetchAllPrices(tickers) {
  var unique = tickers.filter(function(t) { return t; });
  var seen = {};
  unique = unique.filter(function(t) { return seen[t] ? false : (seen[t] = true); });
  var results = {};
  var i = 0;
  function nextBatch() {
    if (i >= unique.length) return Promise.resolve(results);
    var batch = unique.slice(i, i + 5);
    i += 5;
    return Promise.all(batch.map(fetchFinnhubPrice))
      .then(function(prices) {
        prices.forEach(function(p) { if (p) results[p.ticker] = p; });
        if (i < unique.length) {
          return new Promise(function(r) { setTimeout(r, 300); }).then(nextBatch);
        }
        return results;
      });
  }
  return nextBatch();
}

// ─── PARSE POSITIONS ──────────────────────────────────────
function parsePositions(csvText) {
  var rows = parseCSV(csvText);
  return rows.map(function(r) {
    var ticker = esc(r[0] || '');
    var optType = esc(r[1] || 'C');
    var strike = parseDollar(r[2]);
    var expiry = esc(r[3] || '');
    var qty = parseInt(r[4]) || 0;
    var entry = parseDollar(r[5]);
    var dte = parseInt(r[9]) || 0;
    var bucket = esc(r[10] || '');
    return { ticker: ticker, optType: optType, strike: strike, expiry: expiry, qty: qty, entry: entry, cost: entry * qty * 100, dte: dte, bucket: bucket, stockPrice: null };
  }).filter(function(p) { return p.ticker; });
}

// ─── COMPUTE BUCKETS ──────────────────────────────────────
function computeBuckets(positions) {
  var map = {};
  var total = 0;
  positions.forEach(function(p) {
    total += p.cost;
    if (!map[p.bucket]) map[p.bucket] = { capital: 0, count: 0 };
    map[p.bucket].capital += p.cost;
    map[p.bucket].count++;
  });
  return BUCKET_ORDER
    .filter(function(b) { return map[b]; })
    .map(function(b) { return { bucket: b, capital: map[b].capital, count: map[b].count, pct: total > 0 ? (map[b].capital / total) * 100 : 0 }; })
    .sort(function(a, b) { return b.capital - a.capital; });
}

// ─── RENDER ────────────────────────────────────────────────
function renderPortfolio() {
  var el = $('portfolioContent');
  if (!positions.length) {
    el.innerHTML = '<div class="empty">No open positions</div>';
    return;
  }

  var html = '';

  // Buckets card
  html += '<div class="card">';
  var totalCost = positions.reduce(function(s,p) { return s + p.cost; }, 0);
  html += '<div class="card-header">Buckets <span>' + fmtCompact(totalCost) + '</span></div>';
  for (var bi = 0; bi < buckets.length; bi++) {
    var b = buckets[bi];
    html += '<div class="bucket">' +
      '<div class="bucket-top">' +
        '<div class="bucket-left">' +
          '<div class="color-dot" style="background:' + getBucketColor(b.bucket) + '"></div>' +
          '<span class="bucket-name">' + b.bucket + '</span>' +
          '<span class="bucket-count">x' + b.count + '</span>' +
        '</div>' +
        '<div class="bucket-right">' +
          '<div class="bucket-value">' + fmtCompact(b.capital) + '</div>' +
          '<div class="bucket-pct">' + b.pct.toFixed(1) + '%</div>' +
        '</div>' +
      '</div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + Math.max(b.pct, 2) + '%;background:' + getBucketColor(b.bucket) + ';box-shadow:0 0 6px ' + getBucketColor(b.bucket) + '44"></div></div>' +
    '</div>';
  }
  html += '</div>';

  // Positions card
  html += '<div class="card"><div class="card-header">Positions <span>' + positions.length + ' open</span></div>';
  var lastBucket = '';
  for (var pi = 0; pi < positions.length; pi++) {
    var p = positions[pi];
    if (p.bucket !== lastBucket) {
      html += '<div class="section-label">' + p.bucket + '</div>';
      lastBucket = p.bucket;
    }
    var sp = stockPrices[p.ticker];
    var stkPrice = sp ? sp.currentPrice : null;
    var mn = stkPrice ? moneyness(stkPrice, p.strike, p.optType) : { label: '--', cls: '' };
    var dteClass = p.dte <= 7 ? 'expired' : p.dte <= 14 ? 'danger' : p.dte <= 21 ? 'warn' : '';

    var posHtml = '<div class="position">' +
      '<div>' +
        '<div class="pos-ticker">' + p.ticker + '</div>' +
        '<div class="pos-strike">' + fmt(p.strike) + (p.optType === 'P' ? 'p' : 'c') + ' \xb7 ' + p.expiry + '</div>' +
      '</div>' +
      '<div class="pos-mid">' +
        '<div class="pos-entry">' + fmt(p.entry) + ' x' + p.qty + '</div>' +
        '<div class="pos-dte ' + dteClass + '">' + (p.dte > 0 ? p.dte + 'd' : 'expired') + '</div>';
    if (stkPrice) {
      posHtml += '<div class="pos-stock ' + mn.cls + '">' + fmt(stkPrice) + ' \xb7 ' + mn.label + '</div>';
    } else {
      posHtml += '<div class="pos-stock" style="color:var(--dim)">no price</div>';
    }
    posHtml += '</div></div>';
    html += posHtml;
    if (pi < positions.length - 1 && positions[pi+1].bucket === p.bucket) html += '<div class="divider"></div>';
  }
  html += '</div>';

  el.innerHTML = html;
}

function renderSignals() {
  var el = $('signalsContent');
  if (!signals.length) {
    el.innerHTML = '<div class="card"><div class="empty">No signals</div></div>';
    return;
  }
  var html = '<div class="card"><div class="card-header">Skim Quick Entries</div>';
  for (var si = 0; si < signals.length; si++) {
    var s = signals[si];
    var score = parseInt(s.urgency) || 0;
    var scoreCls = score >= 8 ? 'high' : score >= 5 ? 'med' : 'low';
    html += '<div class="signal-row">' +
      '<div class="signal-left">' +
        '<div class="signal-score ' + scoreCls + '">' + score + '/10</div>' +
        '<div>' +
          '<div class="signal-ticker">' + s.ticker + '</div>' +
          '<div class="signal-info">' + (s.strike ? fmt(s.strike) + s.optType + ' \xb7 ' : '') + (s.expiry || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div>' +
        '<div class="signal-action ' + ((s.action || '').toLowerCase() === 'buy' ? 'buy' : 'sell') + '">' + (s.action || '') + '</div>' +
        '<div class="signal-zone">' + (s.zone || '') + '</div>' +
        (s.entryPrice ? '<div class="signal-price" style="color:var(--dim);font-size:10px;margin-top:2px">' + fmt(s.entryPrice) + '</div>' : '') +
      '</div>' +
    '</div>';
    if (si < signals.length - 1) html += '<div class="divider"></div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderTracker() {
  var el = $('trackerContent');
  if (!positions.length) {
    el.innerHTML = '<div class="card"><div class="empty">No positions to track</div></div>';
    return;
  }
  var html = '';
  var lastBucket = '';
  for (var pi = 0; pi < positions.length; pi++) {
    var p = positions[pi];
    if (p.bucket !== lastBucket) {
      if (lastBucket) html += '</div>';
      html += '<div class="card">';
      html += '<div class="card-header">' + p.bucket + '</div>';
      lastBucket = p.bucket;
    }
    var sp = stockPrices[p.ticker];
    var cur = sp ? sp.currentPrice : null;
    var chg = sp ? sp.changePercent : null;

    html += '<div class="price-row">' +
      '<div>' +
        '<div class="price-ticker">' + p.ticker + '</div>' +
        '<div class="price-sub">entry ' + fmt(p.entry) + '</div>' +
      '</div>' +
      '<div class="price-right">';
    if (cur) {
      html += '<div class="price-current">' + fmt(cur) + '</div>' +
        '<div class="price-change ' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '\u25b2' : '\u25bc') + ' ' + pct(chg) + '</div>' +
        '<div class="price-entry">vs entry ' + fmt(cur - p.entry) + '</div>';
    } else {
      html += '<div class="price-current" style="color:var(--dim)">\u2014</div>';
    }
    html += '</div></div>';
    if (pi < positions.length - 1) html += '<div class="divider"></div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// ─── MAIN UPDATE ──────────────────────────────────────────
function updateAll() {
  var posPromise = fetchSheetCSV('Portfolio Quick');
  var sigPromise = fetchSheetCSV('Skim Quick');

  return Promise.all([posPromise, sigPromise])
    .then(function(results) {
      var posCSV = results[0];
      var sigCSV = results[1];

      if (posCSV) {
        positions = parsePositions(posCSV);
        positions.sort(function(a, b) {
          return BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || b.cost - a.cost;
        });
        buckets = computeBuckets(positions);
      }
      if (sigCSV) {
        var rows = parseCSV(sigCSV);
        signals = rows.map(function(r) {
          return {
            ticker: esc(r[0] || ''),
            urgency: parseInt(String(r[1] || '').split('/')[0]) || 0,
            optType: esc(r[2] || 'C'), strike: parseDollar(r[3]),
            expiry: esc(r[4] || ''), action: esc(r[5] || ''),
            entryPrice: parseDollar(r[6] || ''), zone: esc(r[7] || '')
          };
        }).filter(function(s) { return s.ticker && s.urgency > 0; });
      }

      // Fetch stock prices
      var tickers = [];
      positions.forEach(function(p) { if (p.ticker && tickers.indexOf(p.ticker) === -1) tickers.push(p.ticker); });
      if (finnhubKey && tickers.length) {
        return fetchAllPrices(tickers).then(function(prices) {
          stockPrices = prices;
        });
      } else {
        stockPrices = {};
      }
    })
    .then(function() {
      // Render active tab
      var active = document.querySelector('.tab.active');
      if (active) {
        var tab = active.getAttribute('data-tab');
        if (tab === 'portfolio') renderPortfolio();
        else if (tab === 'signals') renderSignals();
        else if (tab === 'tracker') renderTracker();
      }

      $('lastUpdated').textContent = nowStr();
      $('signalsUpdated').textContent = nowStr();
      $('trackerUpdated').textContent = nowStr();
      $('liveDot').className = 'live-dot';
    })
    .catch(function(e) {
      console.error('Update error:', e);
      $('liveDot').className = 'live-dot off';
    });
}

// ─── TABS ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.add('hide'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  var tabEl = document.querySelector('.tab[data-tab="' + name + '"]');
  if (tabEl) tabEl.classList.add('active');
  var contentEl = $(name + 'Tab');
  if (contentEl) contentEl.classList.remove('hide');
  renderActiveTab(name);
}

function renderActiveTab(name) {
  if (name === 'portfolio') renderPortfolio();
  else if (name === 'signals') renderSignals();
  else if (name === 'tracker') renderTracker();
}

function openSettings() {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.add('hide'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  $('settingsView').classList.remove('hide');
  $('finnhubKeyInput').value = finnhubKey;
}

function saveApiKey() {
  var key = $('finnhubKeyInput').value.trim();
  finnhubKey = key;
  localStorage.setItem('finnhubKey', key);
  $('finnhubKeyInput').value = key;
  updateAll();
  switchTab('portfolio');
}

// ─── INIT ──────────────────────────────────────────────────
function init() {
  if (finnhubKey) $('finnhubKeyInput').value = finnhubKey;
  updateAll();
  refreshTimer = setInterval(updateAll, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', function() {
  // Wire up tab clicks
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var tabName = this.getAttribute('data-tab');
      if (tabName === 'settings') {
        openSettings();
      } else {
        switchTab(tabName);
      }
    });
  });

  // Wire up save button
  document.getElementById('saveApiKeyBtn').addEventListener('click', saveApiKey);

  init();
});
