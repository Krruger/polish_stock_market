import React, { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    const chartContainerRef = useRef();
    const chartInstanceRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const priceLinesRef = useRef([]); // Linie S/R
    const stopLossLineRef = useRef(null); // Linia Twojego SL

    // --- STAN KALKULATORA ---
    const [currentPrice, setCurrentPrice] = useState(0);
    const [riskAmount, setRiskAmount] = useState(500); // Domyślnie 500 zł ryzyka
    const [stopLossPrice, setStopLossPrice] = useState(null);
    const [positionSize, setPositionSize] = useState(0);
    const [actualRisk, setActualRisk] = useState(0);

    // Stała dla FW20 (1 pkt = 20 zł)
    const MULTIPLIER = 10;

    // Funkcja obliczająca pozycję
    useEffect(() => {
        if (currentPrice > 0 && stopLossPrice > 0) {
            const dist = Math.abs(currentPrice - stopLossPrice);
            if (dist === 0) return;

            const riskPerContract = dist * MULTIPLIER;
            // floor() żeby nie przekroczyć ryzyka (zaokrąglamy w dół)
            const contracts = Math.floor(riskAmount / riskPerContract);

            setPositionSize(contracts);
            setActualRisk((contracts * riskPerContract).toFixed(2));
        }
    }, [currentPrice, stopLossPrice, riskAmount]);

    useEffect(() => {
        if (!chartContainerRef.current || chartInstanceRef.current) return;

        // 1. Inicjalizacja Wykresu
        const chart = LightweightCharts.createChart(chartContainerRef.current, {
            width: window.innerWidth,
            height: window.innerHeight - 50,
            layout: {
                background: { type: LightweightCharts.ColorType.Solid, color: '#0b0e14' },
                textColor: '#d1d4dc',
            },
            grid: { vertLines: { color: '#161921' }, horzLines: { color: '#161921' } },
            timeScale: { timeVisible: true, borderColor: '#2B2B43', barSpacing: 12 },
            rightPriceScale: { borderColor: '#2B2B43' },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
            wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });

        candleSeriesRef.current = candleSeries;
        chartInstanceRef.current = chart;

        // --- OBSŁUGA KLIKNIĘCIA (USTAWIANIE STOP LOSS) ---
        chart.subscribeClick((param) => {
            if (param.point && candleSeries) {
                // Konwersja współrzędnej Y na cenę
                const price = candleSeries.coordinateToPrice(param.point.y);
                if (price) {
                    const roundedPrice = Math.round(price); // FW20 chodzi co 1 pkt
                    setStopLossPrice(roundedPrice);

                    // Rysowanie/Aktualizacja linii SL na wykresie
                    if (stopLossLineRef.current) {
                        candleSeries.removePriceLine(stopLossLineRef.current);
                    }
                    stopLossLineRef.current = candleSeries.createPriceLine({
                        price: roundedPrice,
                        color: '#FF9800', // Pomarańczowy dla SL
                        lineWidth: 2,
                        lineStyle: LightweightCharts.LineStyle.Solid,
                        axisLabelVisible: true,
                        title: 'MY STOP LOSS',
                    });
                }
            }
        });

        // Funkcja rysująca S/R (z poprzedniego kroku)
        const drawColoredLevels = (levelsData, currPrice) => {
            priceLinesRef.current.forEach(line => candleSeries.removePriceLine(line));
            priceLinesRef.current = [];
            if (!levelsData) return;

            const maxStrength = Math.max(...levelsData.map(l => l.strength));
            levelsData.forEach(level => {
                const strength = level.strength;
                const isSupport = currPrice > level.price;
                const baseColor = isSupport ? '38, 166, 154' : '239, 83, 80';
                let thickness = strength >= 10 ? 4 : (strength >= 6 ? 3 : 2);
                const opacity = Math.min(0.6 + (strength / maxStrength) * 0.35, 0.95);

                const line = candleSeries.createPriceLine({
                    price: level.price,
                    color: `rgba(${baseColor}, ${opacity})`,
                    lineWidth: thickness,
                    lineStyle: strength >= 6 ? LightweightCharts.LineStyle.Solid : LightweightCharts.LineStyle.Dotted,
                    axisLabelVisible: true,
                    title: strength >= 8 ? (isSupport ? 'MAJOR SUP' : 'MAJOR RES') : '',
                });
                priceLinesRef.current.push(line);
            });
        };

        // Pobieranie danych
        fetch('http://localhost:8000/api/v1/history')
            .then(res => res.json())
            .then(data => {
                if (data.history && data.history.length > 0) {
                    const sortedData = data.history.sort((a, b) => a.time - b.time);
                    const last = sortedData[sortedData.length - 1].close;

                    setCurrentPrice(last); // Zapisujemy cenę do stanu Reacta
                    candleSeries.setData(sortedData);

                    if (data.levels) drawColoredLevels(data.levels, last);
                    if (data.markers) candleSeries.setMarkers(data.markers);

                    chart.timeScale().fitContent();
                }
            });

        // WebSocket
        const socket = new WebSocket('ws://localhost:8000/ws');
        socket.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'UPDATE' && candleSeriesRef.current) {
                candleSeriesRef.current.update(msg.candle);
                setCurrentPrice(msg.candle.close); // Aktualizacja ceny na żywo w kalkulatorze

                if (msg.markers) candleSeriesRef.current.setMarkers(msg.markers);
            }
        };

        const handleResize = () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.applyOptions({ width: window.innerWidth, height: window.innerHeight - 50 });
            }
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove(); chartInstanceRef.current = null; socket.close();
        };
    }, []);

    return (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#0b0e14' }}>

            {/* GÓRNY PASEK */}
            <div style={{ height: '50px', width: '100%', backgroundColor: '#131722', display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid #2B2B43', justifyContent: 'space-between' }}>
                <div style={{ color: '#fff', fontWeight: 'bold' }}>FW20 PRO TERMINAL</div>
                <div style={{ color: '#848e9c', fontSize: '13px' }}>1 PKT = 20 PLN</div>
            </div>

            {/* KONTENER WYKRESU */}
            <div style={{ position: 'relative', flex: 1, width: '100%' }}>
                <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />

                {/* --- PANEL KALKULATORA (RISK MANAGER) --- */}
                <div style={{
                    position: 'absolute', bottom: '20px', right: '80px', zIndex: 20,
                    backgroundColor: 'rgba(19, 23, 34, 0.95)', border: '1px solid #2B2B43',
                    borderRadius: '8px', padding: '15px', width: '220px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', fontFamily: 'sans-serif', color: '#d1d4dc'
                }}>
                    <div style={{ borderBottom: '1px solid #2B2B43', paddingBottom: '8px', marginBottom: '10px', fontWeight: 'bold', color: '#FF9800' }}>
                        Risk Manager 🧮
                    </div>

                    {/* INPUT: RYZYKO */}
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ fontSize: '11px', color: '#848e9c' }}>MAX RISK (PLN)</label>
                        <input
                            type="number"
                            value={riskAmount}
                            onChange={(e) => setRiskAmount(Number(e.target.value))}
                            style={{ width: '100%', background: '#0b0e14', border: '1px solid #2B2B43', color: 'white', padding: '5px', borderRadius: '4px' }}
                        />
                    </div>

                    {/* DANE: CENY */}
                    <div style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span>Current:</span> <span style={{ color: '#fff' }}>{currentPrice}</span>
                    </div>
                    <div style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span>Stop Loss:</span>
                        <span style={{ color: stopLossPrice ? '#FF9800' : '#444' }}>
                            {stopLossPrice || "Click Chart"}
                        </span>
                    </div>

                    {/* WYNIK: POZYCJA */}
                    <div style={{ backgroundColor: '#26a69a', color: '#fff', padding: '10px', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase' }}>Position Size</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                            {positionSize} <span style={{ fontSize: '14px' }}>KONTR.</span>
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '4px' }}>
                            Est. Loss: -{actualRisk} PLN
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TradingChart;