import React, { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    // Referencje do wykresów
    const chartH1Ref = useRef();
    const chartM15Ref = useRef();
    const seriesH1 = useRef(null);
    const seriesM15 = useRef(null);

    // Referencje do linii (żeby móc je usuwać i przerysowywać)
    const priceLinesH1 = useRef([]);
    const priceLinesM15 = useRef([]);
    const stopLossLineRef = useRef(null);
    const tpLinesRef = useRef([]);

    // Stany aplikacji
    const [price, setPrice] = useState(0);
    const [adr, setAdr] = useState({ usage: 0, today_range: 0, adr: 0 });
    const [bias, setBias] = useState("NEUTRAL");
    const [riskAmount, setRiskAmount] = useState(500);
    const [stopLossPrice, setStopLossPrice] = useState(0);
    const [tpLevels, setTpLevels] = useState({ tp1: 0, tp2: 0, tp3: 0 });

    const initChart = (container) => {
        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: { background: { color: '#0b0e14' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#161921' }, horzLines: { color: '#161921' } },
            timeScale: { timeVisible: true, borderColor: '#2B2B43' },
            rightPriceScale: { borderColor: '#2B2B43' },
        });
        const series = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
            wickUpColor: '#26a69a', wickDownColor: '#ef5350'
        });
        return { chart, series };
    };

    useEffect(() => {
        if (!chartH1Ref.current || !chartM15Ref.current) return;

        const h1 = initChart(chartH1Ref.current);
        const m15 = initChart(chartM15Ref.current);
        seriesH1.current = h1.series;
        seriesM15.current = m15.series;

        // --- KLIKNIĘCIE: SL i 3xTP ---
        m15.chart.subscribeClick((p) => {
            if (!p.point || !seriesM15.current || price === 0) return;
            const clickedPrice = Math.round(m15.series.coordinateToPrice(p.point.y));
            setStopLossPrice(clickedPrice);

            // Rysuj SL
            if (stopLossLineRef.current) m15.series.removePriceLine(stopLossLineRef.current);
            stopLossLineRef.current = m15.series.createPriceLine({
                price: clickedPrice, color: '#FF9800', lineWidth: 2, title: 'SL', axisLabelVisible: true,
            });

            // Wylicz TP
            const diff = Math.abs(price - clickedPrice);
            const isLong = price > clickedPrice;
            const levels = {
                tp1: isLong ? Math.round(price + diff) : Math.round(price - diff),
                tp2: isLong ? Math.round(price + diff * 1.5) : Math.round(price - diff * 1.5),
                tp3: isLong ? Math.round(price + diff * 2) : Math.round(price - diff * 2),
            };
            setTpLevels(levels);

            // Rysuj 3xTP
            tpLinesRef.current.forEach(l => m15.series.removePriceLine(l));
            tpLinesRef.current = [
                { p: levels.tp1, t: 'TP1 (1:1)', op: 0.4 },
                { p: levels.tp2, t: 'TP2 (1:1.5)', op: 0.7 },
                { p: levels.tp3, t: 'TP3 (1:2)', op: 1.0 }
            ].map(item => m15.series.createPriceLine({
                price: item.p, color: `rgba(33, 150, 243, ${item.op})`, lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed, title: item.t, axisLabelVisible: true,
            }));
        });

        // --- FUNKCJA RYSOWANIA LINII S/R ---
        const drawSRLines = (series, levels, currentPrice, refArray) => {
            refArray.current.forEach(l => series.removePriceLine(l));
            refArray.current = levels.map(lvl => series.createPriceLine({
                price: lvl.price,
                color: currentPrice > lvl.price ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)',
                lineWidth: lvl.strength > 8 ? 2 : 1,
                lineStyle: lvl.strength > 8 ? LightweightCharts.LineStyle.Solid : LightweightCharts.LineStyle.Dotted,
                axisLabelVisible: true,
            }));
        };

        const updateUI = (data) => {
            if (data.m15) {
                const last = data.m15.history[data.m15.history.length - 1].close;
                setPrice(last);
                seriesM15.current.setData(data.m15.history);
                seriesM15.current.setMarkers(data.m15.markers || []);
                setAdr(data.m15.adr);
                if (data.m15.levels) drawSRLines(seriesM15.current, data.m15.levels, last, priceLinesM15);
            }
            if (data.h1) {
                seriesH1.current.setData(data.h1.history);
                seriesH1.current.setMarkers(data.h1.markers || []);
                if (data.h1.levels) drawSRLines(seriesH1.current, data.h1.levels, price, priceLinesH1);
            }
            if (data.bias) setBias(data.bias);
        };

        fetch('http://localhost:8000/api/v1/history').then(res => res.json()).then(updateUI);

        const socket = new WebSocket('ws://localhost:8000/ws');
        socket.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if (m.type === 'UPDATE') {
                seriesM15.current.update(m.candle);
                seriesH1.current.update(m.candle);
                setPrice(m.candle.close);
                if (m.markers) seriesM15.current.setMarkers(m.markers);
                if (m.adr) setAdr(m.adr);
                if (m.bias) setBias(m.bias);
            }
        };

        const handleResize = () => {
            h1.chart.applyOptions({ width: chartH1Ref.current.clientWidth });
            m15.chart.applyOptions({ width: chartM15Ref.current.clientWidth });
        };
        window.addEventListener('resize', handleResize);
        return () => { h1.chart.remove(); m15.chart.remove(); socket.close(); window.removeEventListener('resize', handleResize); };
    }, [price]);

    const slDist = Math.abs(price - stopLossPrice);
    const posSize = slDist > 0 ? Math.floor(riskAmount / (slDist * 10)) : 0;
    const biasColor = bias === 'BULLISH' ? '#26a69a' : bias === 'BEARISH' ? '#ef5350' : '#848e9c';

    return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#0b0e14', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'sans-serif' }}>

            {/* --- HEADER --- */}
            <div style={{ height: '75px', display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between', borderBottom: '1px solid #2B2B43', background: '#131722' }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <b style={{ color: '#26a69a', fontSize: '18px' }}>FW20 SNAJPER</b>
                    <div style={{ background: `${biasColor}11`, padding: '6px 15px', borderRadius: '6px', border: `1px solid ${biasColor}`, textAlign: 'center', minWidth: '100px' }}>
                        <div style={{ fontSize: '9px', color: '#848e9c', fontWeight: 'bold' }}>H1 TREND</div>
                        <b style={{ color: biasColor }}>{bias}</b>
                    </div>
                    <div style={{ background: '#1e222d', padding: '8px 16px', borderRadius: '8px', border: '1px solid #2B2B43', display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '9px', color: '#848e9c' }}>ADR RANGE</span>
                            <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{adr.today_range.toFixed(1)} / {adr.adr.toFixed(1)}</span>
                        </div>
                        <b style={{ color: adr.usage > 90 ? '#ef5350' : '#26a69a' }}>{adr.usage.toFixed(1)}%</b>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '10px', color: '#848e9c' }}>CENA LIVE</div>
                    <div style={{ fontSize: '26px', fontWeight: 'bold' }}>{price}</div>
                </div>
            </div>

            {/* --- CHARTS --- */}
            <div style={{ flex: 1, display: 'flex', gap: '2px', padding: '2px' }}>
                <div style={{ flex: 1, position: 'relative', border: '1px solid #161921' }}>
                    <div style={{ position: 'absolute', top: 10, left: 15, zIndex: 10, color: '#848e9c', fontSize: '11px', fontWeight: 'bold', background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '4px' }}>H1 TREND</div>
                    <div ref={chartH1Ref} style={{ width: '100%', height: '100%' }} />
                </div>
                <div style={{ flex: 1, position: 'relative', border: '1px solid #161921' }}>
                    <div style={{ position: 'absolute', top: 10, left: 15, zIndex: 10, color: '#848e9c', fontSize: '11px', fontWeight: 'bold', background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '4px' }}>M15 SNAJPER</div>
                    <div ref={chartM15Ref} style={{ width: '100%', height: '100%' }} />

                    {/* --- AKTYWNY RISK MANAGER --- */}
                    <div style={{ position: 'absolute', bottom: 30, right: 30, zIndex: 999, background: '#131722f2', padding: '20px', borderRadius: '12px', border: '1px solid #2B2B43', width: '270px', boxShadow: '0 10px 40px rgba(0,0,0,0.6)', pointerEvents: 'auto' }}>
                        <div style={{ color: '#FF9800', fontWeight: 'bold', fontSize: '11px', marginBottom: '15px' }}>RISK MANAGER (RR 1:2) 🧮</div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ fontSize: '10px', color: '#848e9c', display: 'block', marginBottom: '4px' }}>MAX RYZYKO (PLN)</label>
                            <input type="number" value={riskAmount} onChange={(e) => setRiskAmount(Number(e.target.value))} style={{ width: '100%', background: '#0b0e14', border: '1px solid #2B2B43', color: '#fff', padding: '8px', borderRadius: '6px', outline: 'none', fontSize: '16px' }} />
                        </div>
                        <div style={{ background: '#26a69a', padding: '12px', borderRadius: '8px', textAlign: 'center', marginBottom: '15px' }}>
                            <div style={{ fontSize: '10px', color: '#0b0e14', fontWeight: 'bold' }}>WIELKOŚĆ POZYCJI</div>
                            <div style={{ fontSize: '28px', color: '#0b0e14', fontWeight: '900' }}>{posSize} <small style={{ fontSize: '14px' }}>kontr.</small></div>
                        </div>
                        <div style={{ borderTop: '1px solid #2B2B43', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}><span style={{ color: '#848e9c' }}>SL:</span><b>{stopLossPrice || '---'}</b></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}><span style={{ color: '#2196F3' }}>TP1:</span><b>{tpLevels.tp1 || '---'}</b></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}><span style={{ color: '#2196F3' }}>TP3 (Max):</span><b>{tpLevels.tp3 || '---'}</b></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '5px', borderTop: '1px dotted #2B2B43', paddingTop: '5px' }}>
                                <span style={{ color: '#848e9c' }}>Max Zysk:</span><b style={{ color: '#26a69a' }}>{ (posSize * Math.abs(price - tpLevels.tp3) * 10).toFixed(0) } PLN</b>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingChart;