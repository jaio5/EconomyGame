/* Simulation engine. One tick = one in-game hour. */
(function () {
  'use strict';

  const { PRODUCTS, BUILDINGS, RIVALS, EVENTS } = window.GameData;
  const SAVE_KEY = 'economygame.save.v1';
  const SPREAD = 0.04;          // bid/ask spread around the mid price
  const IMPACT = 0.05;          // price move per `liquidity` units traded
  const HIST_LEN = 168;         // one week of hourly prices
  const LOAN_RATE = 0.0004;     // interest per hour
  const MAX_LEVEL = 10;
  const BASE_CAPACITY = 2000;

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let state = null;
  const listeners = [];

  function newGame() {
    const market = {};
    for (const [id, p] of Object.entries(PRODUCTS)) {
      market[id] = { price: p.base * rand(0.9, 1.1), trend: 0, hist: [] };
    }
    const inv = {};
    const autoSell = {};
    for (const id of Object.keys(PRODUCTS)) { inv[id] = 0; autoSell[id] = { on: false, keep: 0 }; }
    state = {
      v: 1,
      hour: 8,
      cash: 10000,
      speed: 1,
      inv, autoSell,
      whLevel: 1,
      buildings: [],
      nextUid: 1,
      market,
      events: [],
      nextEventAt: randInt(36, 72),
      offers: [],
      contracts: [],
      nextOfferAt: 4,
      debt: 0,
      rivals: RIVALS.map((name) => ({ name, worth: rand(9000, 16000), drift: rand(0.0012, 0.0032) })),
      log: [],
      worthHist: [],
      flow: [],
      stats: { produced: 0, revenue: 0, contractsDone: 0 },
    };
    addLog('Bienvenido. Tienes 10.000 $ para levantar tu imperio.', 'info');
    for (let i = 0; i < 3; i++) spawnOffer();
    for (let i = 0; i < 72; i++) stepMarket(); // pre-seed three days of price history
    state.worthHist.push(netWorth());
    return state;
  }

  /* ---------- derived values ---------- */
  const capacity = () => BASE_CAPACITY * state.whLevel;
  const stored = () => Object.values(state.inv).reduce((a, b) => a + b, 0);
  const bid = (id) => state.market[id].price * (1 - SPREAD / 2);
  const ask = (id) => state.market[id].price * (1 + SPREAD / 2);
  const buildingValue = (b) => BUILDINGS[b.type].cost * (1 + (b.level - 1) * 0.8) * 0.5;
  const upgradeCost = (b) => Math.round(BUILDINGS[b.type].cost * b.level * 0.8);
  const warehouseCost = () => 3000 * state.whLevel;
  const loanLimit = () => Math.max(0, Math.max(5000, netWorth() * 0.5) - state.debt);

  function netWorth() {
    let w = state.cash - state.debt;
    for (const [id, q] of Object.entries(state.inv)) w += q * bid(id);
    for (const b of state.buildings) w += buildingValue(b);
    return w;
  }

  function change24h(id) {
    const h = state.market[id].hist;
    const past = h[Math.max(0, h.length - 25)];
    return (state.market[id].price - past) / past;
  }

  function profitPerHour() {
    if (!state.flow.length) return 0;
    return state.flow.reduce((a, b) => a + b, 0) / state.flow.length;
  }

  // Estimated hourly margin of a building at current market prices.
  function estimateMargin(type, level = 1) {
    const def = BUILDINGS[type];
    let m = -def.wage * level;
    for (const [id, q] of Object.entries(def.out)) m += q * level * bid(id);
    for (const [id, q] of Object.entries(def.in)) m -= q * level * ask(id);
    return m;
  }

  /* ---------- logging & notifications ---------- */
  function addLog(text, kind = 'info') {
    state.log.unshift({ h: state.hour, text, kind });
    if (state.log.length > 60) state.log.length = 60;
  }

  function notify(text, kind = 'info') {
    addLog(text, kind);
    for (const fn of listeners) fn({ type: 'toast', text, kind });
  }

  /* ---------- market ---------- */
  function eventMult(id) {
    let m = 1;
    for (const e of state.events) if (e.mults[id]) m *= e.mults[id];
    return m;
  }

  function stepMarket() {
    for (const [id, p] of Object.entries(PRODUCTS)) {
      const mk = state.market[id];
      const target = p.base * eventMult(id);
      // Smoothed noise (AR(1)) gives trends instead of a sawtooth.
      const shock = (Math.random() + Math.random() + Math.random() - 1.5) * 0.006;
      mk.trend = (mk.trend || 0) * 0.82 + shock;
      mk.price += (target - mk.price) * 0.025 + mk.price * mk.trend;
      mk.price = clamp(mk.price, p.base * 0.3, p.base * 3);
      mk.hist.push(mk.price);
      if (mk.hist.length > HIST_LEN) mk.hist.shift();
    }
  }

  // Average execution price for qty units, then moves the market.
  function execute(id, qty, side) {
    const mk = state.market[id];
    const move = IMPACT * qty / PRODUCTS[id].liquidity;
    const base = side === 'buy' ? ask(id) : bid(id);
    const avg = side === 'buy' ? base * (1 + move / 2) : base * (1 - move / 2);
    mk.price = clamp(mk.price * (side === 'buy' ? 1 + move : 1 - move),
      PRODUCTS[id].base * 0.3, PRODUCTS[id].base * 3);
    return avg * qty;
  }

  function quoteBuy(id, qty) { return ask(id) * (1 + IMPACT * qty / PRODUCTS[id].liquidity / 2) * qty; }
  function quoteSell(id, qty) { return bid(id) * (1 - IMPACT * qty / PRODUCTS[id].liquidity / 2) * qty; }

  function maxBuy(id) {
    const room = Math.floor(capacity() - stored());
    let lo = 0, hi = Math.max(0, room);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (quoteBuy(id, mid) <= state.cash) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function buy(id, qty) {
    qty = Math.floor(qty);
    if (qty <= 0) return fail('Indica una cantidad válida.');
    if (stored() + qty > capacity()) return fail('No hay espacio suficiente en el almacén.');
    const cost = quoteBuy(id, qty);
    if (cost > state.cash) return fail('Fondos insuficientes.');
    state.cash -= execute(id, qty, 'buy');
    state.inv[id] += qty;
    notify(`Compraste ${fmtQty(qty)} ${PRODUCTS[id].name.toLowerCase()} por ${fmtMoney(cost)}.`, 'buy');
    return true;
  }

  function sell(id, qty, quiet = false) {
    qty = Math.floor(Math.min(qty, state.inv[id]));
    if (qty <= 0) return quiet ? false : fail('No tienes existencias para vender.');
    const revenue = execute(id, qty, 'sell');
    state.cash += revenue;
    state.inv[id] -= qty;
    state.stats.revenue += revenue;
    if (!quiet) notify(`Vendiste ${fmtQty(qty)} ${PRODUCTS[id].name.toLowerCase()} por ${fmtMoney(revenue)}.`, 'sell');
    return revenue;
  }

  function fail(text) {
    for (const fn of listeners) fn({ type: 'toast', text, kind: 'error' });
    return false;
  }

  /* ---------- buildings ---------- */
  function build(type) {
    const def = BUILDINGS[type];
    if (state.cash < def.cost) return fail('Fondos insuficientes para construir.');
    state.cash -= def.cost;
    state.buildings.push({ uid: state.nextUid++, type, level: 1, on: true, status: 'idle', missing: null });
    notify(`Construiste: ${def.name}.`, 'build');
    return true;
  }

  function upgrade(uid) {
    const b = state.buildings.find((x) => x.uid === uid);
    if (!b) return false;
    if (b.level >= MAX_LEVEL) return fail('Nivel máximo alcanzado.');
    const cost = upgradeCost(b);
    if (state.cash < cost) return fail('Fondos insuficientes para mejorar.');
    state.cash -= cost;
    b.level++;
    notify(`${BUILDINGS[b.type].name} mejorado a nivel ${b.level}.`, 'build');
    return true;
  }

  function toggle(uid) {
    const b = state.buildings.find((x) => x.uid === uid);
    if (b) b.on = !b.on;
    return !!b;
  }

  function demolish(uid) {
    const i = state.buildings.findIndex((x) => x.uid === uid);
    if (i < 0) return false;
    const b = state.buildings[i];
    const refund = buildingValue(b);
    state.cash += refund;
    state.buildings.splice(i, 1);
    notify(`Vendiste ${BUILDINGS[b.type].name} por ${fmtMoney(refund)}.`, 'sell');
    return true;
  }

  function upgradeWarehouse() {
    const cost = warehouseCost();
    if (state.cash < cost) return fail('Fondos insuficientes para ampliar el almacén.');
    state.cash -= cost;
    state.whLevel++;
    notify(`Almacén ampliado a ${fmtQty(capacity())} unidades.`, 'build');
    return true;
  }

  function stepProduction() {
    const order = [...state.buildings].sort((a, b) => BUILDINGS[a.type].tier - BUILDINGS[b.type].tier);
    for (const b of order) {
      const def = BUILDINGS[b.type];
      if (!b.on) { b.status = 'off'; continue; }
      const lv = b.level;
      const missing = Object.entries(def.in).find(([id, q]) => state.inv[id] < q * lv);
      if (missing) {
        b.status = 'missing'; b.missing = missing[0];
        state.cash -= def.wage * lv * 0.5;
        continue;
      }
      const inQ = Object.values(def.in).reduce((a, q) => a + q * lv, 0);
      const outQ = Object.values(def.out).reduce((a, q) => a + q * lv, 0);
      if (stored() - inQ + outQ > capacity()) {
        b.status = 'full';
        state.cash -= def.wage * lv * 0.5;
        continue;
      }
      for (const [id, q] of Object.entries(def.in)) state.inv[id] -= q * lv;
      for (const [id, q] of Object.entries(def.out)) state.inv[id] += q * lv;
      state.stats.produced += outQ;
      state.cash -= def.wage * lv;
      b.status = 'ok'; b.missing = null;
    }
  }

  function stepAutoSell() {
    for (const [id, cfg] of Object.entries(state.autoSell)) {
      if (!cfg.on) continue;
      const excess = Math.floor(state.inv[id] - cfg.keep);
      if (excess > 0) sell(id, excess, true);
    }
  }

  function setAutoSell(id, on, keep) {
    const cfg = state.autoSell[id];
    if (on !== undefined) cfg.on = on;
    if (keep !== undefined && Number.isFinite(keep)) cfg.keep = Math.max(0, Math.floor(keep));
  }

  /* ---------- contracts ---------- */
  function spawnOffer() {
    const candidates = Object.keys(PRODUCTS).filter((id) => PRODUCTS[id].tier >= 1 || Math.random() < 0.3);
    const id = pick(candidates);
    const p = PRODUCTS[id];
    const qty = Math.max(5, Math.round(p.liquidity * rand(0.08, 0.3) / 5) * 5);
    const reward = Math.round(qty * p.base * rand(1.2, 1.45));
    const hours = randInt(48, 120);
    state.offers.push({ id: state.nextUid++, product: id, qty, reward, hours });
    if (state.offers.length > 4) state.offers.shift();
  }

  function acceptOffer(offerId) {
    const i = state.offers.findIndex((o) => o.id === offerId);
    if (i < 0) return false;
    if (state.contracts.length >= 3) return fail('Máximo 3 contratos activos a la vez.');
    const o = state.offers.splice(i, 1)[0];
    state.contracts.push({ ...o, due: state.hour + o.hours });
    notify(`Contrato aceptado: ${fmtQty(o.qty)} ${PRODUCTS[o.product].name.toLowerCase()}.`, 'info');
    return true;
  }

  function deliver(cid) {
    const i = state.contracts.findIndex((c) => c.id === cid);
    if (i < 0) return false;
    const c = state.contracts[i];
    if (state.inv[c.product] < c.qty) return fail('No tienes suficientes existencias para entregar.');
    state.inv[c.product] -= c.qty;
    state.cash += c.reward;
    state.stats.revenue += c.reward;
    state.stats.contractsDone++;
    state.contracts.splice(i, 1);
    notify(`Contrato cumplido. Cobraste ${fmtMoney(c.reward)}.`, 'sell');
    return true;
  }

  function stepContracts() {
    if (state.hour >= state.nextOfferAt) {
      spawnOffer();
      state.nextOfferAt = state.hour + randInt(14, 30);
    }
    for (let i = state.contracts.length - 1; i >= 0; i--) {
      const c = state.contracts[i];
      if (state.hour >= c.due) {
        const penalty = Math.round(c.reward * 0.15);
        state.cash -= penalty;
        state.contracts.splice(i, 1);
        notify(`Contrato vencido. Penalización de ${fmtMoney(penalty)}.`, 'error');
      }
    }
  }

  /* ---------- events ---------- */
  function stepEvents() {
    state.events = state.events.filter((e) => {
      if (state.hour < e.until) return true;
      addLog(`Fin del evento: ${e.title}.`, 'info');
      return false;
    });
    if (state.hour >= state.nextEventAt) {
      const ev = pick(EVENTS.filter((e) => !state.events.some((x) => x.title === e.title)));
      if (ev) {
        state.events.push({ ...ev, until: state.hour + randInt(48, 96) });
        notify(`${ev.title}: ${ev.text}`, 'event');
      }
      state.nextEventAt = state.hour + randInt(60, 140);
    }
  }

  /* ---------- bank ---------- */
  function borrow(amount) {
    amount = Math.floor(amount);
    if (amount <= 0) return fail('Indica un importe válido.');
    if (amount > loanLimit()) return fail('Supera tu límite de crédito.');
    state.debt += amount;
    state.cash += amount;
    notify(`Préstamo recibido: ${fmtMoney(amount)}.`, 'info');
    return true;
  }

  function repay(amount) {
    amount = Math.floor(Math.min(amount, state.debt, state.cash));
    if (amount <= 0) return fail('No hay nada que amortizar o no tienes efectivo.');
    state.debt -= amount;
    state.cash -= amount;
    if (state.debt < 1) state.debt = 0;
    notify(`Amortizaste ${fmtMoney(amount)} de deuda.`, 'info');
    return true;
  }

  /* ---------- rivals ---------- */
  function stepRivals() {
    for (const r of state.rivals) {
      r.worth *= 1 + r.drift + (Math.random() - 0.5) * 0.01;
      if (Math.random() < 0.004) r.worth *= rand(0.85, 0.95);
    }
  }

  /* ---------- main tick ---------- */
  function tick() {
    const before = state.cash;
    state.hour++;
    stepEvents();
    stepMarket();
    stepProduction();
    stepAutoSell();
    stepContracts();
    stepRivals();
    if (state.debt > 0) state.cash -= state.debt * LOAN_RATE;
    state.flow.push(state.cash - before);
    if (state.flow.length > 24) state.flow.shift();
    if (state.hour % 4 === 0) {
      state.worthHist.push(netWorth());
      if (state.worthHist.length > 240) state.worthHist.shift();
    }
    for (const fn of listeners) fn({ type: 'tick' });
  }

  /* ---------- persistence ---------- */
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      state = s;
      return state;
    } catch (e) { return null; }
  }

  function reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
    newGame();
  }

  /* ---------- formatting ---------- */
  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtMoney(n, decimals) {
    const neg = n < 0;
    const abs = Math.abs(n);
    const s = (decimals ?? (abs < 100 ? 2 : 0)) === 2 ? nf2.format(abs) : nf0.format(abs);
    return `${neg ? '−' : ''}${s} $`;
  }
  function fmtQty(n) { return nf0.format(Math.floor(n)); }
  function fmtTime(h) {
    const day = Math.floor(h / 24) + 1;
    return { day, clock: `${String(h % 24).padStart(2, '0')}:00` };
  }

  window.Game = {
    get state() { return state; },
    PRODUCTS, BUILDINGS, MAX_LEVEL,
    newGame, load, save, reset, tick,
    on: (fn) => listeners.push(fn),
    capacity, stored, bid, ask, netWorth, change24h, profitPerHour, estimateMargin,
    upgradeCost, warehouseCost, loanLimit, buildingValue, quoteBuy, quoteSell, maxBuy, LOAN_RATE,
    buy, sell, build, upgrade, toggle, demolish, upgradeWarehouse, setAutoSell,
    acceptOffer, deliver, borrow, repay,
    fmtMoney, fmtQty, fmtTime,
  };
})();
