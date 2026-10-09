# Rift Ledger

Juego de gestión económica para navegador sobre el mapa real del mundo. Abre negocios en edificios reales, construye cadenas de producción, comercia en un mercado con precios vivos, cumple contratos y supera en patrimonio a las corporaciones rivales.

## Cómo jugar

Abre `index.html` directamente en el navegador, o sírvelo localmente:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

No necesita dependencias ni compilación (Leaflet va incluido en `vendor/`). El mapa necesita conexión a internet para las teselas y los edificios. La partida se guarda en `localStorage` (cada 30 horas de juego, al cerrar la pestaña y con el botón **Guardar**).

## Mecánicas

- **Mapa del mundo**: calles reales de OpenStreetMap (estilo oscuro de CARTO). Al acercarte (zoom ≥ 16) se cargan las siluetas reales de los edificios desde la API de Overpass. Haz clic en uno para ver su dirección, tipo, superficie y precio, y abre ahí tu negocio. El precio del local depende de su superficie, del barrio y del uso (comercial más caro, industrial más barato), y la superficie útil (planta × pisos) limita el nivel máximo de ampliación. Algunos edificios ya son de rivales. Incluye buscador de ciudades y calles (Nominatim) y botón de "mi ubicación".
- **Tiempo**: 1 tick = 1 hora de juego. Velocidades pausa / 1× / 2× / 5×.
- **Producción**: 12 instalaciones en 4 niveles (primario → manufactura). Cada una consume insumos del almacén y produce cada hora; si faltan insumos o el almacén está lleno se detiene y paga medio salario. Mejoras hasta nivel 10.
- **Mercado**: 12 productos con precio que revierte a la media, ruido con tendencia, horquilla compra/venta del 4 % e impacto de precio según la liquidez del producto.
- **Eventos**: sequías, huelgas, booms… alteran los precios durante 2–4 días.
- **Almacén**: capacidad ampliable y venta automática con reserva por producto.
- **Contratos**: pedidos con prima sobre mercado, plazo y penalización del 15 % si vencen.
- **Banco**: préstamos hasta el 50 % del patrimonio con interés horario.
- **Ranking**: compite por patrimonio neto contra 5 rivales.

## Atajos de teclado

| Tecla | Acción |
| --- | --- |
| `1`–`8` | Cambiar de sección |
| `Espacio` | Pausar / reanudar |
| `Enter` | Seleccionar fila de producto |

## Interfaz

El sistema de diseño (`css/styles.css`) sigue estos principios:

- Tokens de color en `:root` con un único acento (lima) y colores semánticos para subida y bajada; todo el texto cumple un contraste ≥ 4.5:1.
- Un único sistema de botones: variantes `primary`, secundaria, `ghost`, `danger`, `buy` y `sell`, tamaños `sm`/`md`/`lg`, con estados hover, active (pulsación de 1 px), `focus-visible` (anillo) y disabled.
- Tipografía Geist con Geist Mono y cifras tabulares para todos los números.
- Iconos SVG de trazo en lugar de emojis, con tooltips en los botones que solo muestran un icono.
- Confirmación en dos pasos para acciones destructivas.
- Áreas táctiles de 44 px o más en móvil, navegación inferior y soporte de `prefers-reduced-motion`.

## Estructura

```
index.html       Estructura de la app y sprite de iconos
css/styles.css   Sistema de diseño
js/data.js       Productos, edificios, rivales y eventos
js/game.js       Motor de simulación, guardado y formato
js/map.js        Mapa mundial, edificios reales y apertura de locales
js/ui.js         Vistas, gráficos, entrada y bucle de juego
vendor/leaflet/  Leaflet 1.9.4 (licencia BSD-2)
```

## Datos del mapa

- Mapa base: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions).
- Edificios: API de Overpass (datos de OpenStreetMap, ODbL). Solo se consulta al acercarse, con espera tras cada movimiento y caché por zona.
- Búsqueda: Nominatim, solo al pulsar «Buscar».
