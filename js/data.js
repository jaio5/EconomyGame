/* Static game data: products, buildings, rivals and market events. */
(function () {
  'use strict';

  // liquidity = units the market absorbs before the price moves ~5 %
  const PRODUCTS = {
    agua:         { name: 'Agua',         unit: 'm³', base: 0.6, liquidity: 4000, tier: 0, color: '#5fb3d9' },
    trigo:        { name: 'Trigo',        unit: 't',  base: 3.2, liquidity: 1500, tier: 0, color: '#d9b45f' },
    madera:       { name: 'Madera',       unit: 't',  base: 3.5, liquidity: 1400, tier: 0, color: '#a07b52' },
    mineral:      { name: 'Mineral',      unit: 't',  base: 6,   liquidity: 900,  tier: 0, color: '#b0675a' },
    carbon:       { name: 'Carbón',       unit: 't',  base: 4.5, liquidity: 1100, tier: 0, color: '#7d8590' },
    energia:      { name: 'Energía',      unit: 'MWh', base: 0.9, liquidity: 5000, tier: 1, color: '#f2d64b' },
    harina:       { name: 'Harina',       unit: 't',  base: 11,  liquidity: 600,  tier: 1, color: '#e8dcc0' },
    tablones:     { name: 'Tablones',     unit: 'u',  base: 9,   liquidity: 600,  tier: 1, color: '#c8975e' },
    acero:        { name: 'Acero',        unit: 't',  base: 40,  liquidity: 260,  tier: 2, color: '#9fb4c7' },
    pan:          { name: 'Pan',          unit: 'u',  base: 16,  liquidity: 500,  tier: 2, color: '#e0a35a' },
    muebles:      { name: 'Muebles',      unit: 'u',  base: 140, liquidity: 70,   tier: 3, color: '#c46f4a' },
    herramientas: { name: 'Herramientas', unit: 'u',  base: 130, liquidity: 70,   tier: 3, color: '#8fc7a4' },
  };

  // Per-hour recipes at level 1. Inputs, outputs and wages scale with level.
  const BUILDINGS = {
    pozo:       { name: 'Pozo de agua',        cost: 1500,  wage: 3,  tier: 0, in: {},                                   out: { agua: 20 } },
    granja:     { name: 'Granja',              cost: 5000,  wage: 8,  tier: 0, in: { agua: 10 },                         out: { trigo: 8 } },
    lenador:    { name: 'Explotación forestal', cost: 4500, wage: 8,  tier: 0, in: {},                                   out: { madera: 6 } },
    minaHierro: { name: 'Mina de hierro',      cost: 6000,  wage: 14, tier: 0, in: { energia: 4 },                       out: { mineral: 5 } },
    minaCarbon: { name: 'Mina de carbón',      cost: 5500,  wage: 12, tier: 0, in: { energia: 3 },                       out: { carbon: 6 } },
    central:    { name: 'Central eléctrica',   cost: 4000,  wage: 6,  tier: 1, in: { carbon: 2, agua: 5 },               out: { energia: 30 } },
    molino:     { name: 'Molino',              cost: 5000,  wage: 6,  tier: 1, in: { trigo: 8, energia: 2 },             out: { harina: 4 } },
    serreria:   { name: 'Serrería',            cost: 4500,  wage: 6,  tier: 1, in: { madera: 6, energia: 2 },            out: { tablones: 4 } },
    aceria:     { name: 'Acería',              cost: 18000, wage: 25, tier: 2, in: { mineral: 6, carbon: 4, energia: 10 }, out: { acero: 3 } },
    panaderia:  { name: 'Panadería',           cost: 9000,  wage: 14, tier: 2, in: { harina: 4, agua: 4, energia: 2 },   out: { pan: 5 } },
    muebleria:  { name: 'Fábrica de muebles',  cost: 16000, wage: 14, tier: 3, in: { tablones: 6, acero: 1, energia: 4 }, out: { muebles: 1 } },
    taller:     { name: 'Taller de herramientas', cost: 16000, wage: 14, tier: 3, in: { acero: 2, madera: 1, energia: 4 }, out: { herramientas: 1 } },
  };

  const RIVALS = ['Norvia Holdings', 'Grupo Ostrava', 'Kessler & Hijos', 'Atlas Industrial', 'Meridiano Capital'];

  const EVENTS = [
    { title: 'Sequía prolongada',       text: 'El trigo y el agua se encarecen.',        mults: { trigo: 1.5, agua: 1.4 } },
    { title: 'Cosecha récord',          text: 'Exceso de trigo y harina en el mercado.', mults: { trigo: 0.65, harina: 0.85 } },
    { title: 'Huelga minera',           text: 'Escasez de mineral y carbón.',            mults: { mineral: 1.6, carbon: 1.4 } },
    { title: 'Boom inmobiliario',       text: 'Se disparan muebles y tablones.',          mults: { muebles: 1.45, tablones: 1.25 } },
    { title: 'Ola de frío',             text: 'La demanda eléctrica se dispara.',         mults: { energia: 1.8, carbon: 1.2 } },
    { title: 'Excedente de acero',      text: 'Importaciones baratas hunden el acero.',   mults: { acero: 0.7 } },
    { title: 'Plan de infraestructuras', text: 'El gobierno compra herramientas y acero.', mults: { herramientas: 1.5, acero: 1.25 } },
    { title: 'Festival gastronómico',   text: 'El pan vuela de las estanterías.',         mults: { pan: 1.45, harina: 1.15 } },
    { title: 'Incendio forestal',       text: 'La madera escasea.',                       mults: { madera: 1.6, tablones: 1.2 } },
  ];

  window.GameData = { PRODUCTS, BUILDINGS, RIVALS, EVENTS };
})();
