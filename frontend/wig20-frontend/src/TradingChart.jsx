import React, { useEffect, useRef } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    const chartContainerRef = useRef();
    const chartInstanceRef = useRef(null);
    const candleSeriesRef = useRef(null);

    useEffect(() => {
        if (!chartContainerRef.current || chartInstanceRef.current) return;

        // 1. Obliczanie wymiarów pod 1080p bez żadnych odstępów
        const fullWidth = window.innerWidth - 200;
        const chartHeight = window.innerHeight - 150; // 50px na nagłówek

        const chart = LightweightCharts.createChart(chartContainerRef.current, {
            width: fullWidth,
            height: chartHeight,
            layout: {
                background: { type: LightweightCharts.ColorType.Solid, color: '#0b0e14' },
                textColor: '#d1d4dc',
                fontSize: 14,
            },
            grid: {
                vertLines: { color: '#161921' },
                horzLines: { color: '#161921' },
            },
            timeScale: {
                timeVisible: true,
                borderColor: '#2B2B43',
                barSpacing: 12, // Większe świece = czytelniejszy Price Action
            },
            rightPriceScale: {
                borderColor: '#2B2B43',
                alignLabels: true,
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        candleSeriesRef.current = candleSeries;
        chartInstanceRef.current = chart;

        // Funkcja do rysowania poziomów S/R (Swing Points)
        const applySwingLevels = (levels) => {
            candleSeries.createPriceLine({
                price: levels.daily_high,
                color: '#ef5350',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'RESISTANCE (HIGH)',
            });

            candleSeries.createPriceLine({
                price: levels.daily_low,
                color: '#26a69a',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'SUPPORT (LOW)',
            });
        };

        // Pobieranie danych
        fetch('http://localhost:8000/api/v1/history')
            .then(res => res.json())
            .then(data => {
                if (data.history && data.history.length > 0) {
                    candleSeries.setData(data.history.sort((a, b) => a.time - b.time));
                    if (data.levels) applySwingLevels(data.levels);
                    chart.timeScale().fitContent();
                }
            })
            .catch(err => console.error("History Error:", err));

        // WebSocket
        const socket = new WebSocket('ws://localhost:8000/ws');
        socket.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'UPDATE' && candleSeriesRef.current) {
                candleSeriesRef.current.update(msg.candle);
            }
        };

        // Automatyczne dopasowanie przy zmianie rozmiaru okna
        const handleResize = () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.applyOptions({
                    width: window.innerWidth,
                    height: window.innerHeight - 50
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
            chartInstanceRef.current = null;
            socket.close();
        };
    }, []);

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            margin: 0,
            padding: 0,
            overflow: 'hidden'
        }}>
            {/* Header wypełniający 100% szerokości */}
            <div style={{
                height: '50px',
                width: '90%',
                backgroundColor: '#131722',
                display: 'flex',
                alignItems: 'center',
                padding: '0 20px',
                boxSizing: 'border-box',
                borderBottom: '1px solid #2B2B43',
                justifyContent: 'space-between'
            }}>
                <div style={{ color: '#fff', fontWeight: 'bold' }}>
                    FW20 / WIG20 <span style={{ color: '#848e9c', fontWeight: 'normal', marginLeft: '10px' }}>| 1080p Full-Width View</span>
                </div>
                <div style={{ color: '#26a69a', fontSize: '13px' }}>● SYSTEM LIVE</div>
            </div>

            {/* Wykres bez marginesów bocznych */}
            <div ref={chartContainerRef} style={{ width: '90%', flex: 1 }} />
        </div>
    );
};

export default TradingChart;