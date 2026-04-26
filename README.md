# Simulador de Acciones con Cadenas de Markov

Webapp estática desplegada en **GitHub Pages** — no requiere backend.

## 🚀 [Ver en vivo](https://luciano.github.io/precios_markov/) <!-- actualizar URL -->

## ¿Qué hace?

- Descarga un año de datos históricos de cualquier ticker (Yahoo Finance)
- Construye la **Matriz de Transición de Markov** (Sube/Baja)
- Simula un recorrido estocástico de **100 días** al futuro
- Muestra el carrusel de mercado en tiempo real

## Stack

- HTML · CSS · Vanilla JS
- [Chart.js](https://www.chartjs.org/) — gráficos
- [Yahoo Finance API](https://finance.yahoo.com/) — datos históricos (vía proxy CORS)
- [Highlight.js](https://highlightjs.org/) — resaltado de código

## Cómo desplegar en GitHub Pages

1. Ir a **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` · Carpeta: `/static`
4. Guardar → en minutos el sitio estará en vivo

---

*Investigación Operativa · UTN FRBA · Luciano De Doménico*
