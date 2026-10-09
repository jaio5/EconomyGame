/* Rendering, input handling and the game loop. */
(function () {
  'use strict';

  const G = window.Game;
  const { PRODUCTS, BUILDINGS } = G;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const money = (n, d) => G.fmtMoney(n, d);
  const qty = (n) => G.fmtQty(n);
  const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} %`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  const VIEWS = [
    { id: 'dashboard', label: 'Resumen', icon: 'dashboard' },
    { id: 'map', label: 'Mapa', icon: 'map' },
    { id: 'buildings', label: 'Producción', icon: 'factory' },
    { id: 'market', label: 'Mercado', icon: 'chart' },
    { id: 'warehouse', label: 'Almacén', icon: 'box' },
    { id: 'contracts', label: 'Contratos', icon: 'contract' },
    { id: 'bank', label: 'Banco', icon: 'bank' },
    { id: 'ranking', label: 'Ranking', icon: 'trophy' },
  ];
  const SPEEDS = [0, 1, 2, 5];

  const ui = {
    view: 'dashboard',
    selected: 'trigo',
    tradeQty: 100,
    bankAmount: 5000,
    sig: '',
  };
  try { ui.view = localStorage.getItem('economygame.view') || ui.view; } catch (e) { /* ignore */ }
  if (!VIEWS.some((v) => v.id === ui.view)) ui.view = 'dashboard';

  /* ---------- small helpers ---------- */
  function tok(id, small = false) {
    const p = PRODUCTS[id];
    const mono = p.name.slice(0, 2);
    return `<span class="tok ${small ? 'tok-sm' : ''}"><i style="--c:${p.color}" aria-hidden="true">${esc(mono)}</i>${esc(p.name)}</span>`;
  }
  function recipe(type, level = 1) {
    const def = BUILDINGS[type];
    const part = (obj) => Object.entries(obj).map(([id, q]) => `<span class="tok tok-sm"><span class="q">${qty(q * level)}</span>${tok(id, true)}</span>`).join('');
    const ins = Object.keys(def.in).length ? part(def.in) : '<span class="muted">Sin insumos</span>';
    return `<div class="recipe">${ins}<span class="arrow">${icon('arrow')}</span>${part(def.out)}<span class="muted">/ h</span></div>`;
  }
  // Update text/html of bound nodes only when it changed (keeps hover/focus stable).
  function bind(key, html) {
    for (const el of $$(`[data-b="${key}"]`)) if (el.innerHTML !== html) el.innerHTML = html;
  }
  function cls(key, className) {
    for (const el of $$(`[data-c="${key}"]`)) if (el.className !== className) el.className = className;
  }
  function dis(key, disabled) {
    for (const el of $$(`[data-d="${key}"]`)) el.disabled = disabled;
  }
  const signClass = (n) => (n > 0.0001 ? 'up' : n < -0.0001 ? 'down' : 'muted');

  /* ---------- charts ---------- */
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawLine(canvas, data, opts = {}) {
    if (!canvas || !data || data.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = opts.axis ? 8 : 1, padR = opts.axis ? 64 : 1, padT = opts.axis ? 12 : 3, padB = opts.axis ? 12 : 3;
    let min = Math.min(...data), max = Math.max(...data);
    if (max - min < 1e-9) { max += 1; min -= 1; }
    const range = max - min; min -= range * 0.08; max += range * 0.08;
    const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
    const Y = (v) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
    const color = opts.color || (data[data.length - 1] >= data[0] ? cssVar('--up') : cssVar('--down'));

    if (opts.axis) {
      ctx.strokeStyle = cssVar('--line');
      ctx.fillStyle = cssVar('--muted');
      ctx.font = `500 11px ${cssVar('--mono')}`;
      ctx.lineWidth = 1;
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 3; i++) {
        const v = min + ((max - min) * i) / 3;
        const y = Math.round(Y(v)) + 0.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR + 6, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(opts.fmt ? opts.fmt(v) : v.toFixed(2), w - padR + 12, y);
      }
    }

    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    if (opts.fill !== false) {
      ctx.save();
      ctx.lineTo(X(data.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, h);
      g.addColorStop(0, color + '33'); g.addColorStop(1, color + '00');
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    }
    ctx.strokeStyle = color; ctx.lineWidth = opts.axis ? 2 : 1.5; ctx.lineJoin = 'round';
    ctx.stroke();

    if (opts.axis) {
      const lx = X(data.length - 1), ly = Y(data[data.length - 1]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- shell ---------- */
  function renderNav() {
    const s = G.state;
    const ready = s.contracts.filter((c) => s.inv[c.product] >= c.qty).length;
    $('#nav').innerHTML = VIEWS.map((v, i) => `
      <button class="nav-item" type="button" data-action="nav" data-view="${v.id}" ${ui.view === v.id ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 'icon-lg')}<span>${v.label}</span>
        ${v.id === 'contracts' && ready ? `<span class="nav-badge" aria-label="${ready} listos para entregar">${ready}</span>` : ''}
        <kbd aria-hidden="true">${i + 1}</kbd>
      </button>`).join('');
  }

  function renderSpeed() {
    const s = G.state;
    $('#speed').innerHTML = SPEEDS.map((sp) => `
      <button type="button" role="radio" aria-checked="${s.speed === sp}" data-action="speed" data-speed="${sp}"
        class="${sp === 0 ? 'is-pause' : ''}" aria-label="${sp === 0 ? 'Pausa' : `Velocidad ${sp}×`}" data-tip="${sp === 0 ? 'Pausa (Espacio)' : `${sp} h de juego por segundo`}">
        ${sp === 0 ? icon('pause') : `${sp}×`}
      </button>`).join('');
  }

  function renderTopbar() {
    const s = G.state;
    const t = G.fmtTime(s.hour);
    const pph = G.profitPerHour();
    $('#kpis').innerHTML = `
      <div class="kpi"><span class="kpi-label">Efectivo</span><span class="kpi-value ${s.cash < 0 ? 'down' : ''}">${money(s.cash, 0)}</span></div>
      <div class="kpi hide-sm"><span class="kpi-label">Patrimonio</span><span class="kpi-value">${money(G.netWorth(), 0)}</span></div>
      <div class="kpi hide-md hide-sm"><span class="kpi-label">Flujo / h</span><span class="kpi-value ${signClass(pph)}">${pph >= 0 ? '+' : ''}${money(pph, 0)}</span></div>`;
    $('#clock').innerHTML = `<strong>Día ${t.day} · ${t.clock}</strong><span>${s.speed === 0 ? 'En pausa' : 'En marcha'}</span>`;
  }

  /* ==========================================================================
     Views. Each has render() (full markup), update() (cheap per-tick refresh)
     and optionally sig() (structural signature; when it changes we re-render).
     ========================================================================== */
  const views = {};

  /* ---------- dashboard ---------- */
  views.dashboard = {
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Resumen</h1><p class="page-sub">El estado de tu empresa de un vistazo.</p></div>
          <div class="btn-row">
            <button class="btn" type="button" data-action="nav" data-view="market">${icon('chart')}Ir al mercado</button>
            <button class="btn btn-primary" type="button" data-action="nav" data-view="buildings">${icon('plus')}Construir</button>
          </div>
        </div>
        <div class="grid grid-4">
          <div class="card stat"><div class="stat-label">Efectivo</div><div class="stat-value" data-b="d-cash"></div><div class="stat-foot" data-b="d-debt"></div></div>
          <div class="card stat"><div class="stat-label">Patrimonio neto</div><div class="stat-value" data-b="d-worth"></div><div class="stat-foot" data-b="d-rank"></div></div>
          <div class="card stat"><div class="stat-label">Flujo de caja / h</div><div class="stat-value" data-b="d-pph"></div><div class="stat-foot">Media de las últimas 24 h</div></div>
          <div class="card stat"><div class="stat-label">Instalaciones</div><div class="stat-value" data-b="d-bld"></div><div class="stat-foot" data-b="d-bld-foot"></div></div>
        </div>
        <div class="split" style="margin-top:14px">
          <div class="card">
            <div class="card-head"><div><div class="card-title">Evolución del patrimonio</div><div class="card-sub">Muestra cada 4 horas de juego</div></div></div>
            <canvas class="chart" id="worth-chart" role="img" aria-label="Gráfico de patrimonio"></canvas>
          </div>
          <div class="card">
            <div class="card-head"><div class="card-title">Eventos de mercado</div></div>
            <div data-b="d-events" style="display:flex;flex-direction:column;gap:8px"></div>
          </div>
        </div>
        <div class="split" style="margin-top:14px">
          <div class="card">
            <div class="card-head"><div class="card-title">Actividad reciente</div></div>
            <ul class="log" data-b="d-log"></ul>
          </div>
          <div class="card">
            <div class="card-head"><div><div class="card-title">Mayores movimientos</div><div class="card-sub">Variación en 24 h</div></div></div>
            <div data-b="d-movers"></div>
          </div>
        </div>`;
    },
    update() {
      const s = G.state;
      const worth = G.netWorth();
      const pph = G.profitPerHour();
      bind('d-cash', `<span class="${s.cash < 0 ? 'down' : ''}">${money(s.cash, 0)}</span>`);
      bind('d-debt', s.debt > 0 ? `Deuda: <span class="num down">${money(s.debt, 0)}</span>` : 'Sin deuda');
      bind('d-worth', money(worth, 0));
      bind('d-rank', `Puesto ${rankPosition()} de ${s.rivals.length + 1}`);
      bind('d-pph', `<span class="${signClass(pph)}">${pph >= 0 ? '+' : ''}${money(pph, 0)}</span>`);
      const active = s.buildings.filter((b) => b.status === 'ok').length;
      bind('d-bld', `${active}<span class="muted" style="font-size:16px"> / ${s.buildings.length}</span>`);
      bind('d-bld-foot', s.buildings.length ? `${s.buildings.length - active} parada(s) o sin insumos` : 'Aún no tienes edificios');
      bind('d-events', s.events.length
        ? s.events.map((e) => `<div class="event">${icon('bolt')}<div><strong>${esc(e.title)}</strong><p>${esc(e.text)} Quedan ${e.until - s.hour} h.</p></div></div>`).join('')
        : '<p class="muted">Mercado estable. Ningún evento activo.</p>');
      bind('d-log', s.log.slice(0, 8).map((l) => {
        const t = G.fmtTime(l.h);
        return `<li><time>D${t.day} ${t.clock}</time><span class="k-${l.kind}">${esc(l.text)}</span></li>`;
      }).join(''));
      const movers = Object.keys(PRODUCTS).map((id) => [id, G.change24h(id)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
      bind('d-movers', `<table class="table"><tbody>${movers.map(([id, c]) => `
        <tr class="row-btn" tabindex="0" data-action="goto-product" data-id="${id}">
          <td>${tok(id)}</td><td class="r num">${money(G.state.market[id].price, 2)}</td><td class="r num ${signClass(c)}">${pct(c)}</td>
        </tr>`).join('')}</tbody></table>`);
      drawLine($('#worth-chart'), s.worthHist.length > 1 ? s.worthHist : [s.worthHist[0], s.worthHist[0]], { axis: true, color: cssVar('--accent'), fmt: (v) => money(v, 0) });
    },
  };

  function rankPosition() {
    const w = G.netWorth();
    return G.state.rivals.filter((r) => r.worth > w).length + 1;
  }

  function statusBadge(b) {
    const map = {
      ok: ['ok', 'Produciendo'],
      missing: ['warn', `Falta ${PRODUCTS[b.missing]?.name.toLowerCase() || 'insumo'}`],
      full: ['bad', 'Almacén lleno'],
      off: ['', 'Detenida'],
      idle: ['', 'Arrancando'],
    };
    const [k, label] = map[b.status] || map.idle;
    return `<span class="badge ${k}">${label}</span>`;
  }

  /* ---------- buildings ---------- */
  views.buildings = {
    sig: () => G.state.buildings.map((b) => `${b.uid}:${b.level}:${b.on}`).join(','),
    render() {
      const s = G.state;
      const owned = s.buildings.length ? `
        <div class="card"><div class="owned-list">${s.buildings.map((b) => {
          const def = BUILDINGS[b.type];
          const maxed = b.level >= G.maxLevel(b);
          return `
          <div class="owned">
            <div class="owned-name"><span class="level">N${b.level}</span><span>${esc(def.name)}
              ${b.site ? `<button class="link-btn" type="button" data-action="locate" data-uid="${b.uid}">${icon('pin')}${esc(b.site.addr)}</button>` : '<span class="owned-addr">Polígono genérico</span>'}</span></div>
            ${recipe(b.type, b.level)}
            <span data-c="st-${b.uid}"><span data-b="st-${b.uid}"></span></span>
            <div class="btn-row">
              <button class="btn btn-sm" type="button" data-action="upgrade" data-uid="${b.uid}" data-d="up-${b.uid}" ${maxed ? 'disabled' : ''}>
                ${icon('up')}${maxed ? (b.site ? 'Sin espacio' : 'Nivel máx.') : `Mejorar <span class="btn-meta">${money(G.upgradeCost(b), 0)}</span>`}
              </button>
              <button class="btn btn-sm btn-icon ${b.on ? '' : 'btn-ghost'}" type="button" data-action="toggle" data-uid="${b.uid}"
                aria-pressed="${b.on}" aria-label="${b.on ? 'Detener' : 'Reanudar'} ${esc(def.name)}" data-tip="${b.on ? 'Detener producción' : 'Reanudar producción'}">${icon('power')}</button>
              <button class="btn btn-sm btn-icon btn-danger" type="button" data-action="demolish" data-uid="${b.uid}"
                aria-label="Vender ${esc(def.name)}" data-tip="Vender por ${money(G.buildingValue(b), 0)}">${icon('trash')}</button>
            </div>
          </div>`;
        }).join('')}</div></div>` : `
        <div class="empty">
          ${icon('factory', 'icon-lg')}
          <strong>Todavía no tienes instalaciones</strong>
          <span>Empieza por materias primas baratas como un pozo o una explotación forestal y vende la producción en el mercado.</span>
        </div>`;

      const catalog = Object.entries(BUILDINGS).map(([type, def]) => `
        <article class="card bcard">
          <div class="row">
            <div><div class="card-title">${esc(def.name)}</div><div class="card-sub">Nivel ${def.tier === 0 ? 'primario' : def.tier === 1 ? 'de transformación' : def.tier === 2 ? 'industrial' : 'manufactura'}</div></div>
            <span class="badge plain mono" data-b="own-${type}"></span>
          </div>
          ${recipe(type)}
          <div class="meta">
            <div><span>Margen estimado / h</span><span data-b="mg-${type}"></span></div>
            <div><span>Salarios / h</span><span>${money(def.wage, 0)}</span></div>
          </div>
          <div class="actions">
            <button class="btn btn-primary btn-grow" type="button" data-action="place" data-type="${type}" data-d="b-${type}">
              ${icon('pin')}Elegir ubicación <span class="btn-meta">desde ${money(def.cost, 0)}</span>
            </button>
          </div>
        </article>`).join('');

      return `
        <div class="page-head">
          <div><h1 class="page-title">Producción</h1><p class="page-sub">Abre negocios en edificios reales del mapa y encadena su producción. El precio final suma el local según su tamaño y zona. Los insumos salen de tu almacén; si faltan, la planta se detiene y paga medio salario.</p></div>
        </div>
        <h2 class="section-title">Tus instalaciones <span class="muted mono" style="letter-spacing:0">${s.buildings.length}</span></h2>
        ${owned}
        <h2 class="section-title">Construir</h2>
        <div class="grid grid-auto">${catalog}</div>`;
    },
    update() {
      const s = G.state;
      for (const b of s.buildings) {
        bind(`st-${b.uid}`, statusBadge(b));
        dis(`up-${b.uid}`, b.level >= G.maxLevel(b) || s.cash < G.upgradeCost(b));
      }
      for (const [type, def] of Object.entries(BUILDINGS)) {
        const m = G.estimateMargin(type);
        bind(`mg-${type}`, `<span class="${signClass(m)}">${m >= 0 ? '+' : ''}${money(m, 0)}</span>`);
        const n = s.buildings.filter((b) => b.type === type).length;
        bind(`own-${type}`, n ? `×${n}` : '');
        dis(`b-${type}`, s.cash < def.cost);
      }
    },
  };

  /* ---------- market ---------- */
  views.market = {
    render() {
      const rows = Object.keys(PRODUCTS).map((id) => `
        <tr class="row-btn" tabindex="0" data-action="select" data-id="${id}" aria-selected="${ui.selected === id}">
          <td>${tok(id)}</td>
          <td class="r num" data-b="p-${id}"></td>
          <td class="r num" data-b="c-${id}"></td>
          <td class="hide-sm"><canvas class="spark" data-spark="${id}" aria-hidden="true"></canvas></td>
          <td class="r num" data-b="s-${id}"></td>
        </tr>`).join('');
      return `
        <div class="page-head">
          <div><h1 class="page-title">Mercado</h1><p class="page-sub">Precios vivos. Cada operación mueve el precio según la liquidez del producto; vender grandes lotes de golpe sale caro.</p></div>
        </div>
        <div class="split">
          <div class="card" style="padding:14px 6px">
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Producto</th><th class="r">Precio</th><th class="r">24 h</th><th class="hide-sm">7 días</th><th class="r">Stock</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
          <div class="card trade" id="trade">${tradePanel()}</div>
        </div>`;
    },
    update() {
      const s = G.state;
      for (const id of Object.keys(PRODUCTS)) {
        const c = G.change24h(id);
        bind(`p-${id}`, money(s.market[id].price, 2));
        bind(`c-${id}`, `<span class="${signClass(c)}">${pct(c)}</span>`);
        bind(`s-${id}`, s.inv[id] >= 1 ? qty(s.inv[id]) : '<span class="muted">—</span>');
        drawLine($(`[data-spark="${id}"]`), s.market[id].hist, { fill: false });
      }
      updateTrade();
    },
  };

  function tradePanel() {
    const id = ui.selected;
    const p = PRODUCTS[id];
    const cfg = G.state.autoSell[id];
    return `
      <div class="card-head" style="margin:0">
        <div>${tok(id)}<div class="card-sub" style="margin-top:6px">Precio base ${money(p.base, 2)} · por ${esc(p.unit)}</div></div>
        <span class="num" style="font-size:20px;font-weight:600" data-b="t-price"></span>
      </div>
      <canvas class="chart chart-sm" id="trade-chart" role="img" aria-label="Historial de precio de ${esc(p.name)}"></canvas>
      <div class="quote">
        <div><span>Compra (ask)</span><strong class="up" data-b="t-ask"></strong></div>
        <div><span>Venta (bid)</span><strong class="down" data-b="t-bid"></strong></div>
      </div>
      <div class="field">
        <label class="field-label" for="trade-qty">Cantidad</label>
        <input class="input" id="trade-qty" type="number" min="1" step="1" inputmode="numeric" value="${ui.tradeQty}">
        <div class="chips">
          <button class="chip" type="button" data-action="qty" data-q="10">10</button>
          <button class="chip" type="button" data-action="qty" data-q="100">100</button>
          <button class="chip" type="button" data-action="qty" data-q="500">500</button>
          <button class="chip" type="button" data-action="qty" data-q="maxbuy">Máx. compra</button>
          <button class="chip" type="button" data-action="qty" data-q="all">Todo el stock</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="trade-total"><span>Coste estimado</span><span class="num" data-b="t-cost"></span></div>
        <div class="trade-total"><span>Ingreso estimado</span><span class="num" data-b="t-rev"></span></div>
        <div class="trade-total"><span>En almacén</span><span class="num" data-b="t-stock"></span></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-buy btn-lg btn-grow" type="button" data-action="buy" data-d="t-buy">Comprar</button>
        <button class="btn btn-sell btn-lg btn-grow" type="button" data-action="sell" data-d="t-sell">Vender</button>
      </div>
      <div class="divider"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <label class="switch">
          <input type="checkbox" data-action="autosell" data-id="${id}" ${cfg.on ? 'checked' : ''}>
          <span class="switch-track"></span>Venta automática
        </label>
        <label class="field-label" style="display:flex;align-items:center;gap:8px">Reservar
          <input class="input input-sm" type="number" min="0" step="10" value="${cfg.keep}" data-action="keep" data-id="${id}" aria-label="Unidades a reservar">
        </label>
      </div>`;
  }

  function updateTrade() {
    const id = ui.selected;
    const s = G.state;
    const q = Math.max(0, Math.floor(ui.tradeQty || 0));
    const sellQ = Math.min(q, Math.floor(s.inv[id]));
    const cost = G.quoteBuy(id, q);
    bind('t-price', money(s.market[id].price, 2));
    bind('t-ask', money(G.ask(id), 2));
    bind('t-bid', money(G.bid(id), 2));
    bind('t-cost', `<span class="${cost > s.cash ? 'down' : ''}">${money(cost, 2)}</span>`);
    bind('t-rev', sellQ < q && q > 0 ? `${money(G.quoteSell(id, sellQ), 2)} <span class="muted">(${qty(sellQ)} u.)</span>` : money(G.quoteSell(id, sellQ), 2));
    bind('t-stock', `${qty(s.inv[id])} ${esc(PRODUCTS[id].unit)}`);
    dis('t-buy', q <= 0 || cost > s.cash || G.stored() + q > G.capacity());
    dis('t-sell', sellQ <= 0);
    drawLine($('#trade-chart'), s.market[id].hist, { axis: true, fmt: (v) => money(v, 2) });
  }

  /* ---------- warehouse ---------- */
  views.warehouse = {
    render() {
      const rows = Object.keys(PRODUCTS).map((id) => `
        <tr>
          <td>${tok(id)}</td>
          <td class="r num" data-b="w-q-${id}"></td>
          <td class="r num hide-sm" data-b="w-v-${id}"></td>
          <td><label class="switch"><input type="checkbox" data-action="autosell" data-id="${id}" ${G.state.autoSell[id].on ? 'checked' : ''}><span class="switch-track"></span><span class="sr-only">Venta automática de ${esc(PRODUCTS[id].name)}</span></label></td>
          <td><input class="input input-sm" type="number" min="0" step="10" value="${G.state.autoSell[id].keep}" data-action="keep" data-id="${id}" aria-label="Reserva de ${esc(PRODUCTS[id].name)}"></td>
          <td class="r"><button class="btn btn-sm btn-sell" type="button" data-action="sellall" data-id="${id}" data-d="w-sell-${id}">Vender todo</button></td>
        </tr>`).join('');
      return `
        <div class="page-head">
          <div><h1 class="page-title">Almacén</h1><p class="page-sub">Controla tus existencias. Activa la venta automática para liquidar cada hora todo lo que supere la reserva.</p></div>
        </div>
        <div class="grid grid-3">
          <div class="card stat" style="grid-column:span 2">
            <div class="stat-label">Ocupación</div>
            <div class="stat-value" data-b="w-used"></div>
            <div class="progress" data-c="w-bar" style="margin-top:12px"><span data-w="w-bar"></span></div>
          </div>
          <div class="card stat" style="display:flex;flex-direction:column;justify-content:space-between;gap:12px">
            <div><div class="stat-label">Ampliar almacén</div><div class="stat-foot">+${qty(2000)} unidades de capacidad</div></div>
            <button class="btn btn-primary" type="button" data-action="warehouse" data-d="w-up">${icon('up')}Ampliar <span class="btn-meta" data-b="w-cost"></span></button>
          </div>
        </div>
        <div class="card" style="margin-top:14px;padding:14px 6px">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Producto</th><th class="r">Cantidad</th><th class="r hide-sm">Valor</th><th>Auto</th><th>Reserva</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    },
    update() {
      const s = G.state;
      const used = G.stored(), cap = G.capacity(), ratio = used / cap;
      bind('w-used', `${qty(used)} <span class="muted" style="font-size:16px">/ ${qty(cap)}</span>`);
      cls('w-bar', `progress ${ratio > 0.95 ? 'bad' : ratio > 0.8 ? 'warn' : ''}`);
      const bar = $('[data-w="w-bar"]'); if (bar) bar.style.width = `${Math.min(100, ratio * 100)}%`;
      bind('w-cost', money(G.warehouseCost(), 0));
      dis('w-up', s.cash < G.warehouseCost());
      for (const id of Object.keys(PRODUCTS)) {
        bind(`w-q-${id}`, s.inv[id] >= 1 ? qty(s.inv[id]) : '<span class="muted">0</span>');
        bind(`w-v-${id}`, money(s.inv[id] * G.bid(id), 0));
        dis(`w-sell-${id}`, s.inv[id] < 1);
      }
    },
  };

  /* ---------- contracts ---------- */
  views.contracts = {
    sig: () => [...G.state.contracts, ...G.state.offers].map((c) => c.id).join(','),
    render() {
      const s = G.state;
      const active = s.contracts.length ? `<div class="grid grid-auto">${s.contracts.map((c) => `
        <article class="card bcard">
          <div class="row">${tok(c.product)}<span class="badge" data-c="ct-due-${c.id}"><span data-b="ct-due-${c.id}"></span></span></div>
          <div>
            <div class="trade-total" style="margin-bottom:8px"><span>Entregar</span><span class="num" data-b="ct-have-${c.id}"></span></div>
            <div class="progress" data-c="ct-bar-${c.id}"><span data-w="ct-bar-${c.id}"></span></div>
          </div>
          <div class="meta"><div><span>Recompensa</span><span class="up">${money(c.reward, 0)}</span></div><div><span>Penalización</span><span class="down">${money(c.reward * 0.15, 0)}</span></div></div>
          <div class="actions"><button class="btn btn-primary btn-grow" type="button" data-action="deliver" data-cid="${c.id}" data-d="ct-go-${c.id}">${icon('check')}Entregar</button></div>
        </article>`).join('')}</div>`
        : '<div class="empty"><strong>Sin contratos activos</strong><span>Acepta una oferta para cobrar por encima del precio de mercado.</span></div>';

      const offers = s.offers.length ? `<div class="grid grid-auto">${s.offers.map((o) => {
        const market = o.qty * G.bid(o.product);
        return `
        <article class="card bcard">
          <div class="row">${tok(o.product)}<span class="badge plain mono">${o.hours} h</span></div>
          <div class="meta">
            <div><span>Cantidad</span><span>${qty(o.qty)} ${esc(PRODUCTS[o.product].unit)}</span></div>
            <div><span>Recompensa</span><span class="up">${money(o.reward, 0)}</span></div>
          </div>
          <p class="card-sub">Prima frente a mercado: <span class="num up">${pct(o.reward / market - 1)}</span></p>
          <div class="actions"><button class="btn btn-grow" type="button" data-action="accept" data-oid="${o.id}" data-d="of-${o.id}">Aceptar contrato</button></div>
        </article>`;
      }).join('')}</div>` : '<div class="empty"><strong>No hay ofertas ahora</strong><span>Llegan nuevas ofertas cada día de juego.</span></div>';

      return `
        <div class="page-head">
          <div><h1 class="page-title">Contratos</h1><p class="page-sub">Pedidos de clientes con prima sobre el mercado. Si no entregas a tiempo pagas una penalización del 15 %.</p></div>
        </div>
        <h2 class="section-title">Activos <span class="muted mono" style="letter-spacing:0">${s.contracts.length} / 3</span></h2>
        ${active}
        <h2 class="section-title">Ofertas disponibles</h2>
        ${offers}`;
    },
    update() {
      const s = G.state;
      for (const c of s.contracts) {
        const have = Math.min(s.inv[c.product], c.qty);
        const left = c.due - s.hour;
        bind(`ct-have-${c.id}`, `${qty(have)} / ${qty(c.qty)}`);
        bind(`ct-due-${c.id}`, `${left} h`);
        cls(`ct-due-${c.id}`, `badge ${left < 12 ? 'bad' : left < 24 ? 'warn' : ''}`);
        cls(`ct-bar-${c.id}`, `progress ${have >= c.qty ? '' : 'warn'}`);
        const bar = $(`[data-w="ct-bar-${c.id}"]`); if (bar) bar.style.width = `${(have / c.qty) * 100}%`;
        dis(`ct-go-${c.id}`, s.inv[c.product] < c.qty);
      }
      for (const o of s.offers) dis(`of-${o.id}`, s.contracts.length >= 3);
    },
  };

  /* ---------- bank ---------- */
  views.bank = {
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Banco</h1><p class="page-sub">Financia tu expansión. El límite de crédito es el 50 % de tu patrimonio (mínimo 5.000 $). Los intereses se cobran cada hora.</p></div>
        </div>
        <div class="grid grid-3">
          <div class="card stat"><div class="stat-label">Deuda pendiente</div><div class="stat-value" data-b="bk-debt"></div><div class="stat-foot" data-b="bk-int"></div></div>
          <div class="card stat"><div class="stat-label">Crédito disponible</div><div class="stat-value" data-b="bk-limit"></div><div class="stat-foot">Tipo: ${(G.LOAN_RATE * 100).toFixed(2)} % por hora</div></div>
          <div class="card stat"><div class="stat-label">Efectivo</div><div class="stat-value" data-b="bk-cash"></div><div class="stat-foot">Disponible para amortizar</div></div>
        </div>
        <div class="card" style="margin-top:14px;max-width:560px">
          <div class="field">
            <label class="field-label" for="bank-amount">Importe</label>
            <input class="input" id="bank-amount" type="number" min="0" step="500" inputmode="numeric" value="${ui.bankAmount}">
            <div class="chips">
              <button class="chip" type="button" data-action="bankqty" data-q="1000">1.000</button>
              <button class="chip" type="button" data-action="bankqty" data-q="5000">5.000</button>
              <button class="chip" type="button" data-action="bankqty" data-q="25000">25.000</button>
              <button class="chip" type="button" data-action="bankqty" data-q="limit">Límite</button>
              <button class="chip" type="button" data-action="bankqty" data-q="debt">Toda la deuda</button>
            </div>
          </div>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn btn-primary btn-lg btn-grow" type="button" data-action="borrow" data-d="bk-borrow">Pedir préstamo</button>
            <button class="btn btn-lg btn-grow" type="button" data-action="repay" data-d="bk-repay">Amortizar</button>
          </div>
        </div>`;
    },
    update() {
      const s = G.state;
      const a = Math.floor(ui.bankAmount || 0);
      bind('bk-debt', `<span class="${s.debt > 0 ? 'down' : ''}">${money(s.debt, 0)}</span>`);
      bind('bk-int', s.debt > 0 ? `Intereses: ${money(s.debt * G.LOAN_RATE, 2)} / h` : 'Sin intereses');
      bind('bk-limit', money(G.loanLimit(), 0));
      bind('bk-cash', money(s.cash, 0));
      dis('bk-borrow', a <= 0 || a > G.loanLimit());
      dis('bk-repay', a <= 0 || s.debt <= 0 || s.cash <= 0);
    },
  };

  /* ---------- ranking ---------- */
  views.ranking = {
    sig: () => rankingRows().map((r) => r.name).join(','),
    render() {
      return `
        <div class="page-head">
          <div><h1 class="page-title">Ranking</h1><p class="page-sub">Clasificación por patrimonio neto frente a las corporaciones rivales.</p></div>
        </div>
        <div class="card" style="max-width:760px">${rankingRows().map((r, i) => `
          <div class="rank ${r.me ? 'me' : ''}">
            <span class="pos">#${i + 1}</span>
            <div><div style="font-weight:600">${esc(r.name)}</div><div class="rank-bar"><span data-w="rk-${i}"></span></div></div>
            <span class="num" data-b="rk-v-${i}"></span>
          </div>`).join('')}</div>`;
    },
    update() {
      const rows = rankingRows();
      const top = Math.max(...rows.map((r) => r.worth), 1);
      rows.forEach((r, i) => {
        bind(`rk-v-${i}`, money(r.worth, 0));
        const bar = $(`[data-w="rk-${i}"]`); if (bar) bar.style.width = `${Math.max(2, (r.worth / top) * 100)}%`;
      });
    },
  };

  function rankingRows() {
    return [...G.state.rivals.map((r) => ({ name: r.name, worth: r.worth })), { name: 'Tu empresa', worth: G.netWorth(), me: true }]
      .sort((a, b) => b.worth - a.worth);
  }

  /* ---------- map ---------- */
  views.map = window.createMapView({ ui, icon, esc, money, recipe, statusBadge, refresh: () => refresh(), go: (v) => go(v) });

  /* ---------- render orchestration ---------- */
  let mounted = null;
  function renderView() {
    const v = views[ui.view];
    const main = $('#main');
    const focusedId = document.activeElement?.id;
    if (mounted && mounted.unmount) mounted.unmount();
    main.innerHTML = v.render();
    main.dataset.view = ui.view;
    mounted = v;
    if (v.mount) v.mount(main);
    ui.sig = v.sig ? v.sig() : '';
    v.update();
    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  function refresh() {
    const v = views[ui.view];
    renderTopbar();
    if (v.sig && v.sig() !== ui.sig) renderView(); else v.update();
    renderNavBadges();
  }

  let lastBadge = '';
  function renderNavBadges() {
    const s = G.state;
    const key = s.contracts.filter((c) => s.inv[c.product] >= c.qty).length + '|' + ui.view;
    if (key !== lastBadge) { lastBadge = key; renderNav(); }
  }

  function go(view) {
    if (!views[view]) return;
    ui.view = view;
    try { localStorage.setItem('economygame.view', view); } catch (e) { /* ignore */ }
    renderNav();
    renderView();
    $('#main').focus({ preventScroll: true });
    if (view !== 'map') window.scrollTo({ top: 0 });
  }

  /* ---------- toasts ---------- */
  const TOAST_ICON = { error: 'alert', event: 'bolt', sell: 'check', buy: 'check', build: 'check', info: 'check' };
  function toast(text, kind) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast k-${kind}`;
    el.innerHTML = `${icon(TOAST_ICON[kind] || 'check')}<span>${esc(text)}</span>`;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }, kind === 'error' ? 4200 : 3000);
  }

  /* ---------- two-step confirmation for destructive buttons ---------- */
  function confirmFirst(btn, label) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    const prev = { html: btn.innerHTML, cls: btn.className, tip: btn.getAttribute('data-tip') };
    btn.className = btn.className.replace('btn-icon', '').replace('btn-danger', '').replace('btn-ghost', '') + ' btn-confirm';
    btn.removeAttribute('data-tip');
    btn.innerHTML = `${icon('alert')}${label}`;
    setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.armed;
      btn.innerHTML = prev.html; btn.className = prev.cls;
      if (prev.tip) btn.setAttribute('data-tip', prev.tip);
    }, 3000);
    return false;
  }

  /* ---------- input handling ---------- */
  function afterAction() { refresh(); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const a = t.dataset.action;
    const s = G.state;
    switch (a) {
      case 'nav': go(t.dataset.view); break;
      case 'speed': setSpeed(Number(t.dataset.speed)); break;
      case 'goto-product': ui.selected = t.dataset.id; go('market'); break;
      case 'select':
        ui.selected = t.dataset.id;
        $$('[data-action="select"]').forEach((r) => r.setAttribute('aria-selected', String(r.dataset.id === ui.selected)));
        $('#trade').innerHTML = tradePanel();
        updateTrade();
        break;
      case 'qty': {
        const q = t.dataset.q;
        ui.tradeQty = q === 'maxbuy' ? G.maxBuy(ui.selected) : q === 'all' ? Math.floor(s.inv[ui.selected]) : Number(q);
        $('#trade-qty').value = ui.tradeQty;
        updateTrade();
        break;
      }
      case 'buy': G.buy(ui.selected, ui.tradeQty); afterAction(); break;
      case 'sell': G.sell(ui.selected, ui.tradeQty); afterAction(); break;
      case 'sellall': G.sell(t.dataset.id, s.inv[t.dataset.id]); afterAction(); break;
      case 'place': ui.placing = t.dataset.type; go('map'); break;
      case 'locate': ui.locate = Number(t.dataset.uid); go('map'); break;
      case 'upgrade': G.upgrade(Number(t.dataset.uid)); refresh(); break;
      case 'toggle': G.toggle(Number(t.dataset.uid)); refresh(); break;
      case 'demolish': if (confirmFirst(t, 'Confirmar')) { G.demolish(Number(t.dataset.uid)); refresh(); } break;
      case 'warehouse': G.upgradeWarehouse(); refresh(); break;
      case 'accept': G.acceptOffer(Number(t.dataset.oid)); refresh(); break;
      case 'deliver': G.deliver(Number(t.dataset.cid)); refresh(); break;
      case 'bankqty': {
        const q = t.dataset.q;
        ui.bankAmount = q === 'limit' ? Math.floor(G.loanLimit()) : q === 'debt' ? Math.ceil(s.debt) : Number(q);
        $('#bank-amount').value = ui.bankAmount;
        refresh();
        break;
      }
      case 'borrow': G.borrow(ui.bankAmount); refresh(); break;
      case 'repay': G.repay(ui.bankAmount); refresh(); break;
      case 'save': {
        const ok = G.save();
        toast(ok ? 'Partida guardada en este navegador.' : 'No se pudo guardar (almacenamiento no disponible).', ok ? 'info' : 'error');
        break;
      }
      case 'reset':
        if (confirmFirst(t, '¿Borrar partida?')) { G.reset(); G.save(); lastBadge = ''; renderSpeed(); go('dashboard'); toast('Nueva partida iniciada.', 'info'); }
        break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.action === 'autosell') {
      G.setAutoSell(t.dataset.id, t.checked);
      $$(`[data-action="autosell"][data-id="${t.dataset.id}"]`).forEach((x) => { x.checked = t.checked; });
    }
    if (t.dataset.action === 'keep') G.setAutoSell(t.dataset.id, undefined, Number(t.value));
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'trade-qty') { ui.tradeQty = Number(e.target.value); updateTrade(); }
    if (e.target.id === 'bank-amount') { ui.bankAmount = Number(e.target.value); views.bank.update(); }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === 'Enter' && e.target.matches('tr.row-btn')) { e.target.click(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= '1' && e.key <= String(VIEWS.length)) { go(VIEWS[Number(e.key) - 1].id); }
    else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); setSpeed(G.state.speed === 0 ? (ui.lastSpeed || 1) : 0); }
  });

  /* ---------- loop ---------- */
  let timer = null;
  let ticks = 0;
  function setSpeed(sp) {
    if (G.state.speed) ui.lastSpeed = G.state.speed;
    G.state.speed = sp;
    renderSpeed();
    renderTopbar();
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!G.state.speed) return;
    timer = setTimeout(() => {
      G.tick();
      if (++ticks % 30 === 0) G.save();
      schedule();
    }, 1000 / G.state.speed);
  }

  G.on((ev) => {
    if (ev.type === 'tick') refresh();
    if (ev.type === 'toast') toast(ev.text, ev.kind);
  });

  window.addEventListener('resize', () => views[ui.view].update());
  window.addEventListener('beforeunload', () => G.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) G.save(); });

  /* ---------- boot ---------- */
  if (!G.load()) G.newGame();
  renderNav();
  renderSpeed();
  renderTopbar();
  renderView();
  schedule();
  if (document.fonts) document.fonts.ready.then(() => views[ui.view].update());
})();
