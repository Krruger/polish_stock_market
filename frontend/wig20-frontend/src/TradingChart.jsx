import React, { useEffect, useRef } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const TradingChart = () => {
    const chartContainerRef = useRef();
    const chartInstanceRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const volumeSeriesRef = useRef(null);
    const vwapSeriesRef = useRef(null);

    // Funkcja licząca VWAP z resetem każdego dnia
    const calculateDailyVWAP = (data) => {
        let cumulativePV = 0;
        let cumulativeVol = 0;
        let lastDate = "";

        return data.map(d => {
            const currentDate = new Date(d.time * 1000).toISOString().split('T')[0];

            // Jeśli zaczyna się nowy dzień, resetujemy liczniki VWAP
            if (currentDate !== lastDate) {
                cumulativePV = 0;
                cumulativeVol = 0;
                lastDate = currentDate;
            }

            cumulativePV += d.close * d.volume;
            cumulativeVol += d.volume;

            return {
                time: d.time,
                value: cumulativeVol !== 0 ? cumulativePV / cumulativeVol : d.close
            };
        });
    };

    useEffect(() => {
        if (!chartContainerRef.current || chartInstanceRef.current) return;

        // 1. Stworzenie wykresu
        const chart = LightweightCharts.createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 600,
            layout: {
                background: { type: LightweightCharts.ColorType.Solid, color: '#131722' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: '#2B2B43' },
                horzLines: { color: '#2B2B43' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#485c7b'
            },
            // Konfiguracja osobnej skali dla wolumenu
            leftPriceScale: {
                visible: false,
            },
        });

        // 2. Dodanie serii (Świece, VWAP, Wolumen)
        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a', downColor: '#ef5350',
            borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });

        const vwapSeries = chart.addLineSeries({
            color: '#2962FF',
            lineWidth: 2,
            title: 'VWAP',
            priceScaleId: 'right', // ta sama skala co cena
        });

        const volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol', // własna skala
        });

        // Pozycjonowanie wolumenu na dole (dolne 20% wykresu)
        chart.priceScale('vol').applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });

        candleSeriesRef.current = candleSeries;
        vwapSeriesRef.current = vwapSeries;
        volumeSeriesRef.current = volumeSeries;
        chartInstanceRef.current = chart;

        // 3. Pobieranie danych historycznych
        fetch('http://localhost:8000/api/v1/history')
            .then(res => res.json())
            .then(data => {
                if (data && data.length > 0) {
                    const sortedData = data.sort((a, b) => a.time - b.time);

                    // Ustawienie świec
                    candleSeries.setData(sortedData);

                    // Ustawienie VWAP
                    const vwapData = calculateDailyVWAP(sortedData);
                    vwapSeries.setData(vwapData);

                    // Ustawienie wolumenu
                    const volumeData = sortedData.map(d => ({
                        time: d.time,
                        value: d.volume,
                        color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                    }));
                    volumeSeries.setData(volumeData);

                    chart.timeScale().fitContent();
                }
            })
            .catch(err => console.error("API Error:", err));

        // 4. WebSocket (Live Update)
        const socket = new WebSocket('http://localhost:8000/ws');
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'UPDATE' && candleSeriesRef.current) {
                const candle = message.candle;

                // Aktualizujemy wszystko na raz
                candleSeriesRef.current.update(candle);

                volumeSeriesRef.current.update({
                    time: candle.time,
                    value: candle.volume,
                    color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                });

                // VWAP live (uproszczony - bierze cenę zamknięcia)
                vwapSeriesRef.current.update({
                    time: candle.time,
                    value: candle.close
                });
            }
        };

        return () => {
            chart.remove();
            chartInstanceRef.current = null;
            socket.close();
        };
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', padding: '10px' }}>
            <div ref={chartContainerRef} style={{ width: '100%', height: '600px' }} />
            <div style={{
                position: 'absolute', top: '25px', left: '25px', zIndex: 10,
                color: 'white', fontFamily: 'sans-serif', background: 'rgba(0,0,0,0.4)',
                padding: '10px', borderRadius: '4px', pointerEvents: 'none'
            }}>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>WIG20 INDEX</div>
                <div style={{ fontSize: '12px', marginTop: '4px', display: 'flex', gap: '10px' }}>
                    <span><span style={{color: '#26a69a'}}>●</span> Price</span>
                    <span><span style={{color: '#2962FF'}}>●</span> VWAP</span>
                    <span><span style={{color: 'rgba(239, 83, 80, 0.8)'}}>●</span> Vol</span>
                </div>
            </div>
        </div>
    );
};

export default TradingChart;