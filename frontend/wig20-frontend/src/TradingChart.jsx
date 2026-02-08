import React, { useEffect, useRef } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    const chartContainerRef = useRef();
    const chartInstanceRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const priceLinesRef = useRef([]);

    useEffect(() => {
        if (!chartContainerRef.current || chartInstanceRef.current) return;

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
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
            wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });

        candleSeriesRef.current = candleSeries;
        chartInstanceRef.current = chart;

        const drawColoredLevels = (levelsData, currentPrice) => {
            priceLinesRef.current.forEach(line => candleSeries.removePriceLine(line));
            priceLinesRef.current = [];
            if (!levelsData || levelsData.length === 0) return;

            const maxStrength = Math.max(...levelsData.map(l => l.strength));

            levelsData.forEach(level => {
                const strength = level.strength;
                const isSupport = currentPrice > level.price;
                const baseColor = isSupport ? '38, 166, 154' : '239, 83, 80';
                const thickness = strength >= 10 ? 4 : (strength >= 6 ? 3 : 2);
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

        // Fetch początkowy
        fetch('http://localhost:8000/api/v1/history')
            .then(res => res.json())
            .then(data => {
                if (data.history && data.history.length > 0) {
                    const sortedData = data.history.sort((a, b) => a.time - b.time);
                    candleSeries.setData(sortedData);
                    if (data.levels) drawColoredLevels(data.levels, sortedData[sortedData.length - 1].close);

                    // Ustawianie markerów
                    if (data.markers && data.markers.length > 0) {
                        console.log("Ładowanie markerów:", data.markers);
                        candleSeries.setMarkers(data.markers);
                    }
                    chart.timeScale().fitContent();
                }
            });

        const socket = new WebSocket('ws://localhost:8000/ws');
        socket.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'UPDATE' && candleSeriesRef.current) {
                candleSeriesRef.current.update(msg.candle);
                if (msg.markers) {
                    candleSeriesRef.current.setMarkers(msg.markers);
                }
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
            <div style={{ height: '50px', width: '100%', backgroundColor: '#131722', display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid #2B2B43', justifyContent: 'space-between' }}>
                <div style={{ color: '#fff', fontWeight: 'bold' }}>FW20 SMART MONITOR</div>
                <div style={{ display: 'flex', gap: '20px', fontSize: '12px' }}>
                    <span style={{ color: '#26a69a' }}>● BUY</span> <span style={{ color: '#ef5350' }}>● SELL</span>
                </div>
            </div>
            <div ref={chartContainerRef} style={{ width: '100%', flex: 1 }} />
        </div>
    );
};

export default TradingChart;