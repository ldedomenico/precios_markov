document.addEventListener("DOMContentLoaded", () => {

    // ---- Navegación de Tabs ----
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Highlight.js para bloques de código
    hljs.highlightAll();

    // ============================
    // YAHOO FINANCE via Proxy
    // ============================
    async function fetchYahoo(ticker, range = "1y", interval = "1d") {
        const queryHost = "https://query2.finance.yahoo.com"; // query2 suele ser más estable
        const target = `${queryHost}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;
        
        // Intentar con corsproxy.io primero
        const primaryUrl = "https://corsproxy.io/?" + encodeURIComponent(target);
        
        try {
            const resp = await fetch(primaryUrl);
            if (resp.status === 403 || !resp.ok) throw new Error(`Primary proxy failed (${resp.status})`);
            const json = await resp.json();
            return parseYahooResponse(json);
        } catch (err) {
            console.warn(`Primary proxy failed for ${ticker}, trying fallback...`, err);
            
            // Fallback: AllOrigins con el endpoint /get (que devuelve JSON con el contenido en 'contents')
            const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
            try {
                const resp = await fetch(fallbackUrl);
                if (!resp.ok) throw new Error(`Fallback proxy failed (${resp.status})`);
                const data = await resp.json();
                const json = JSON.parse(data.contents); // AllOrigins wrapper
                return parseYahooResponse(json);
            } catch (fallbackErr) {
                console.error(`Both proxies failed for ${ticker}:`, fallbackErr);
                throw new Error("No se pudo conectar con los servicios de datos (HTTP 403/500). Intente más tarde.");
            }
        }
    }

    function parseYahooResponse(json) {
        if (json.chart && json.chart.error) {
            throw new Error(json.chart.error.description || "Error Yahoo Finance");
        }
        const result = json.chart && json.chart.result && json.chart.result[0];
        if (!result) throw new Error("Sin resultados para ese ticker");
        return result;
    }

    // ---- Carrusel de Mercado ----
    const MARKET_TICKERS = ["YPF", "GGAL", "AAPL", "MSFT", "NVDA", "TSLA", "MELI", "BMA", "PAM", "CEPU", "GC=F", "CL=F"];

    async function loadMarketSummary() {
        const carousel = document.getElementById("marketCarousel");
        try {
            const results = await Promise.allSettled(
                MARKET_TICKERS.map(async (t) => {
                    const r = await fetchYahoo(t, "5d", "1d");
                    const quote = r.indicators.quote[0];
                    if (!quote || !quote.close) throw new Error("No data");
                    
                    const closes = quote.close.filter(v => v != null);
                    if (closes.length < 1) throw new Error("No prices");
                    
                    const price = closes[closes.length - 1];
                    const prev  = closes.length > 1 ? closes[closes.length - 2] : price;
                    const changePct = ((price - prev) / prev) * 100;
                    
                    return { ticker: t, price: price.toFixed(2), change_pct: changePct };
                })
            );

            const items = results
                .filter(r => r.status === "fulfilled")
                .map(r => r.value);

            if (items.length === 0) {
                console.warn("All market tickers failed to load.");
                throw new Error("Sin datos");
            }

            const loopData = [...items, ...items, ...items];
            let html = '';
            loopData.forEach(item => {
                const arrow = item.change_pct >= 0 ? "▲" : "▼";
                const colorClass = item.change_pct >= 0 ? "up" : "down";
                html += `
                <span class="ticker-item">
                    <span class="ticker-name">${item.ticker}</span>
                    <span class="ticker-price">$${item.price}</span>
                    <span class="ticker-change ${colorClass}">${arrow} ${item.change_pct.toFixed(2)}%</span>
                </span>`;
            });
            carousel.innerHTML = html;

        } catch (e) {
            console.error("Market summary error:", e);
            carousel.innerHTML = `<span class="ticker-item">Mercados Globales Fuera de Línea</span>`;
        }
    }

    loadMarketSummary();

    // ============================
    // LÓGICA DE MARKOV (JavaScript)
    // ============================
    function computeMarkov(closes) {
        // Calcular estados: Subió / Bajó
        const states = [];
        for (let i = 1; i < closes.length; i++) {
            states.push(closes[i] >= closes[i - 1] ? "U" : "D");
        }

        // Contar transiciones
        let ss = 0, sd = 0, ds = 0, dd = 0;
        for (let i = 1; i < states.length; i++) {
            const prev = states[i - 1], curr = states[i];
            if (prev === "U" && curr === "U") ss++;
            else if (prev === "U" && curr === "D") sd++;
            else if (prev === "D" && curr === "U") ds++;
            else dd++;
        }

        const rowU = ss + sd || 1;
        const rowD = ds + dd || 1;

        const T = {
            UU: ss / rowU,
            UD: sd / rowU,
            DU: ds / rowD,
            DD: dd / rowD
        };

        // Calcular retornos para distribución normal
        const upReturns = [], downReturns = [];
        for (let i = 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) upReturns.push(diff);
            else downReturns.push(Math.abs(diff));
        }

        const mean  = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const std   = arr => {
            if (arr.length < 2) return arr[0] ?? 0.5;
            const m = mean(arr);
            return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
        };

        return {
            T,
            upMean: mean(upReturns),
            upStd: std(upReturns),
            downMean: mean(downReturns),
            downStd: std(downReturns),
            lastState: states[states.length - 1] ?? "U"
        };
    }

    // Box-Muller para distribución normal
    function randNormal(mean, std) {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function simulatePrices(lastPrice, markov, steps = 100) {
        const { T, upMean, upStd, downMean, downStd } = markov;
        let state = markov.lastState;
        let price = lastPrice;
        const prices = [];

        for (let i = 0; i < steps; i++) {
            const prob = Math.random();
            if (state === "U") {
                state = prob < T.UU ? "U" : "D";
            } else {
                state = prob < T.DU ? "U" : "D";
            }

            const delta = Math.abs(randNormal(
                state === "U" ? upMean : downMean,
                state === "U" ? upStd  : downStd
            ));
            price = state === "U" ? price + delta : Math.max(price - delta, 0.01);
            prices.push(price);
        }
        return prices;
    }

    // Generar fechas futuras (días hábiles aproximados)
    function generateFutureDates(lastDate, steps) {
        const dates = [];
        let d = new Date(lastDate);
        let count = 0;
        while (count < steps) {
            d.setDate(d.getDate() + 1);
            const day = d.getDay();
            if (day !== 0 && day !== 6) {
                dates.push(d.toISOString().slice(0, 10));
                count++;
            }
        }
        return dates;
    }

    // ---- UI del Simulador ----
    const simulateBtn    = document.getElementById("simulateBtn");
    const tickerInput    = document.getElementById("tickerInput");
    const btnText        = document.getElementById("btnText");
    const btnSpinner     = document.getElementById("btnSpinner");
    const errorMsg       = document.getElementById("errorMsg");
    const statsPanel     = document.getElementById("statsPanel");
    const initialState   = document.getElementById("initialState");
    const canvasContainer = document.getElementById("canvasContainer");

    const st_ss = document.getElementById("st_ss");
    const st_bs = document.getElementById("st_bs");
    const st_sb = document.getElementById("st_sb");
    const st_bb = document.getElementById("st_bb");

    let stockChart = null;

    Chart.defaults.color = '#cbd5e1';
    Chart.defaults.font.family = "'Inter', sans-serif";

    simulateBtn.addEventListener("click", () => {
        const ticker = tickerInput.value.trim().toUpperCase();
        if (!ticker) return;
        runSimulation(ticker);
    });

    tickerInput.addEventListener("keydown", e => {
        if (e.key === "Enter") simulateBtn.click();
    });

    async function runSimulation(ticker) {
        btnText.classList.add("hidden");
        btnSpinner.classList.remove("hidden");
        simulateBtn.disabled = true;
        errorMsg.classList.add("hidden");

        try {
            const result = await fetchYahoo(ticker, "1y", "1d");

            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];

            // Usar promedio entre Open y Close, igual que el modelo Python
            const rawDates  = [];
            const rawAvg    = [];

            for (let i = 0; i < timestamps.length; i++) {
                const o = quote.open[i], c = quote.close[i];
                if (o == null || c == null) continue;
                const avg = (o + c) / 2;
                const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
                rawDates.push(dateStr);
                rawAvg.push(avg);
            }

            if (rawAvg.length < 30) throw new Error("Datos históricos insuficientes");

            const markov = computeMarkov(rawAvg);
            const lastPrice = rawAvg[rawAvg.length - 1];
            const lastDate  = rawDates[rawDates.length - 1];

            const simPrices = simulatePrices(lastPrice, markov, 100);
            const simDates  = generateFutureDates(lastDate, 100);

            // Mostrar estadísticas
            st_ss.textContent = `${(markov.T.UU * 100).toFixed(1)}%`;
            st_bs.textContent = `${(markov.T.UD * 100).toFixed(1)}%`;
            st_sb.textContent = `${(markov.T.DU * 100).toFixed(1)}%`;
            st_bb.textContent = `${(markov.T.DD * 100).toFixed(1)}%`;

            renderChart(ticker, rawDates, rawAvg, simDates, simPrices);

            initialState.classList.add("hidden");
            canvasContainer.classList.remove("hidden");
            statsPanel.classList.remove("hidden");

        } catch (err) {
            console.error(err);
            errorMsg.textContent = `Error: ${err.message}. Verifique el ticker e intente de nuevo.`;
            errorMsg.classList.remove("hidden");
        } finally {
            btnText.classList.remove("hidden");
            btnSpinner.classList.add("hidden");
            simulateBtn.disabled = false;
        }
    }

    function renderChart(ticker, histDates, histPrices, simDates, simPrices) {
        const ctx = document.getElementById('stockChart').getContext('2d');
        if (stockChart) stockChart.destroy();

        const allDates = [...histDates, ...simDates];
        const numHist  = histDates.length;
        const numSim   = simDates.length;

        const historicalDataset = new Array(allDates.length).fill(null);
        for (let i = 0; i < numHist; i++) historicalDataset[i] = histPrices[i];

        const simulatedDataset = new Array(allDates.length).fill(null);
        simulatedDataset[numHist - 1] = histPrices[numHist - 1];
        for (let i = 0; i < numSim; i++) simulatedDataset[numHist + i] = simPrices[i];

        let gradBlue = ctx.createLinearGradient(0, 0, 0, 400);
        gradBlue.addColorStop(0, 'rgba(59, 130, 246, 0.5)');
        gradBlue.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

        let gradPurple = ctx.createLinearGradient(0, 0, 0, 400);
        gradPurple.addColorStop(0, 'rgba(168, 85, 247, 0.5)');
        gradPurple.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

        stockChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: allDates,
                datasets: [
                    {
                        label: `Histórico (${ticker})`,
                        data: historicalDataset,
                        borderColor: '#3b82f6',
                        backgroundColor: gradBlue,
                        borderWidth: 2,
                        fill: true,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        tension: 0.1
                    },
                    {
                        label: 'Simulación Estocástica Markov',
                        data: simulatedDataset,
                        borderColor: '#c084fc',
                        backgroundColor: gradPurple,
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: true,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, boxWidth: 8 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleFont: { size: 13 },
                        bodyFont: { size: 13 },
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', {
                                        style: 'currency', currency: 'USD'
                                    }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: { maxTicksLimit: 12 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: {
                            callback: v => '$' + v.toFixed(2)
                        }
                    }
                }
            }
        });
    }
});
