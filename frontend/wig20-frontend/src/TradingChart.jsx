import React, { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    const chartContainerRef = useRef();
    const chartInstanceRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const priceLinesRef = useRef([]);
    const stopLossLineRef = useRef(null);

    const [adr, setAdr] = useState({ adr: 0, today_range: 0, usage: 0 });
    const [price, setPrice] = useState(0);
    const [riskAmount, setRiskAmount] = useState(500);
    const [stopLossPrice, setStopLossPrice] = useState(0);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // 1. Inicjalizacja wykresu
        const chart = LightweightCharts.createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: window.innerHeight - 70,
            layout: { background: { color: '#0b0e14' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#161921' }, horzLines: { color: '#161921' } },
            timeScale: { timeVisible: true, barSpacing: 10 },
            rightPriceScale: { borderColor: '#2B2B43' }
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
            wickUpColor: '#26a69a', wickDownColor: '#ef5350'
        });

        candleSeriesRef.current = candleSeries;
        chartInstanceRef.current = chart;

        // 2. Obsługa kliknięcia (Stop Loss)
        chart.subscribeClick((p) => {
            if (!p.point) return;
            const clickedPrice = Math.round(candleSeries.coordinateToPrice(p.point.y));
            setStopLossPrice(clickedPrice);

            if (stopLossLineRef.current) candleSeries.removePriceLine(stopLossLineRef.current);
            stopLossLineRef.current = candleSeries.createPriceLine({
                price: clickedPrice, color: '#FF9800', lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'SL',
            });
        });

        // 3. Funkcja odświeżająca wszystko na wykresie
        const updateUI = (data) => {
            if (!data.history?.length) return;

            // Świeczki
            const sorted = data.history.sort((a,b) => a.time - b.time);
            candleSeries.setData(sorted);
            const last = sorted[sorted.length-1].close;
            setPrice(last);

            // Poziomy S/R (Grube/Cienkie)
            if (data.levels) {
                priceLinesRef.current.forEach(l => candleSeries.removePriceLine(l));
                priceLinesRef.current = data.levels.map(lvl => candleSeries.createPriceLine({
                    price: lvl.price,
                    color: last > lvl.price ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)',
                    lineWidth: lvl.strength >= 10 ? 4 : (lvl.strength >= 6 ? 2 : 1),
                    lineStyle: lvl.strength >= 6 ? LightweightCharts.LineStyle.Solid : LightweightCharts.LineStyle.Dotted,
                    axisLabelVisible: true,
                    title: lvl.strength >= 10 ? 'MAJOR' : '',
                }));
            }

            // KROPKI BUY/SELL (Markery)
            if (data.markers) {
                candleSeries.setMarkers(data.markers);
            }

            // ADR
            if (data.adr) setAdr(data.adr);
        };

        // Pobranie historii na starcie
        fetch('http://localhost:8000/api/v1/history')
            .then(res => res.json())
            .then(updateUI);

        // Odbieranie danych LIVE
        const socket = new WebSocket('ws://localhost:8000/ws');
        socket.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.type === 'UPDATE' && candleSeriesRef.current) {
                // Aktualizacja ceny (ostatnia świeca)
                candleSeriesRef.current.update(m.candle);
                setPrice(m.candle.close);

                // AKTUALIZACJA KROPEK (To naprawia Twój problem!)
                if (m.markers) {
                    candleSeriesRef.current.setMarkers(m.markers);
                }

                // Aktualizacja ADR
                if (m.adr) setAdr(m.adr);

                // Aktualizacja poziomów (jeśli się zmieniły)
                if (m.levels) {
                    // Opcjonalnie: przerysuj linie jeśli backend wysłał nową strukturę
                }
            }
        };

        const handleResize = () => chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        window.addEventListener('resize', handleResize);
        return () => { window.removeEventListener('resize', handleResize); chart.remove(); socket.close(); };
    }, []);

    // Obliczenia Risk Managera (1 pkt = 10 PLN)
    const slDist = Math.abs(price - stopLossPrice);
    const posSize = slDist > 0 ? Math.floor(riskAmount / (slDist * 10)) : 0;

    return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#0b0e14', color: '#fff', overflow: 'hidden', fontFamily: 'Arial' }}>

            {/* GÓRNY PASEK (HEADER) */}
            <div style={{ height: '60px', background: '#131722', display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between', borderBottom: '1px solid #2B2B43' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
                    <b style={{ color: '#26a69a', fontSize: '20px' }}>FW20 SNIPER</b>
                    <div style={{ background: '#1e222d', padding: '6px 15px', borderRadius: '4px', border: `1px solid ${adr.usage > 90 ? '#ef5350' : '#26a69a'}` }}>
                        <span style={{ fontSize: '11px', color: '#848e9c' }}>ADR FUEL: </span>
                        <b style={{ color: adr.usage > 90 ? '#ef5350' : '#26a69a' }}>{adr.usage}%</b>
                        <span style={{ fontSize: '12px', marginLeft: '8px' }}>({adr.today_range} / {adr.adr} pkt)</span>
                    </div>
                </div>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{price}</div>
            </div>

            <div style={{ position: 'relative', height: 'calc(100vh - 60px)' }}>
                <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />

                {/* --- RISK MANAGER (LICZNIK) --- */}
                <div style={{ position: 'absolute', bottom: '30px', right: '100px', zIndex: 9999, width: '220px', background: '#1c202b', padding: '15px', borderRadius: '10px', border: '2px solid #26a69a', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                    <div style={{ color: '#FF9800', fontSize: '11px', fontWeight: 'bold', marginBottom: '10px' }}>RISK MANAGER 🧮</div>
                    <label style={{ fontSize: '10px', color: '#848e9c' }}>MAX RISK (PLN)</label>
                    <input type="number" value={riskAmount} onChange={e => setRiskAmount(Number(e.target.value))} style={{ width: '100%', background: '#0b0e14', border: '1px solid #2B2B43', color: '#fff', padding: '5px', borderRadius: '4px', marginBottom: '10px' }} />
                    <div style={{ fontSize: '12px', marginBottom: '10px' }}>SL Price: <b style={{ color: '#FF9800' }}>{stopLossPrice || '---'}</b></div>
                    <div style={{ background: '#26a69a', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#0b0e14', fontWeight: 'bold' }}>POZYCJA</div>
                        <div style={{ fontSize: '26px', color: '#0b0e14', fontWeight: 'bold' }}>{posSize} <small style={{ fontSize: '12px' }}>KONTR.</small></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingChart;