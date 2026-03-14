import asyncio
import os

import yfinance as yf
import pandas as pd
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from indicators.indicators import detect_filtered_structure

load_dotenv()

TOLERANCE = float(os.getenv("S_R_TOLERANCE", 5.0))
TAIL_SIZE = int(os.getenv("S_R_TAIL_SIZE", 9999999))
PERIOD_M1 = os.getenv("PERIOD_M15", "8d")
PERIOD_M5 = os.getenv("PERIOD_H1", "8d")
def get_trend_bias(df_h1, levels_h1, markers_h1):
    """Analizuje H1 i zwraca kierunek dominujący."""
    try:
        if df_h1.empty: return "NEUTRAL"

        last_close = to_f(df_h1['Close'].iloc[-1])

        # 1. Sprawdzamy ostatni sygnał (Marker) na H1
        last_marker_text = markers_h1[-1]['text'] if markers_h1 else None

        # 2. Znajdujemy najbliższy silny poziom (MAJOR)
        major_levels = [l for l in levels_h1 if l['strength'] > 8]
        last_major = major_levels[-1]['price'] if major_levels else None

        # LOGIKA WERDYKTU
        if last_marker_text == "BUY" and (not last_major or last_close > last_major):
            return "BULLISH"
        elif last_marker_text == "SELL" and (not last_major or last_close < last_major):
            return "BEARISH"

        # Fallback: pozycjonowanie względem ceny
        if last_major:
            return "BULLISH" if last_close > last_major else "BEARISH"

        return "NEUTRAL"
    except:
        return "NEUTRAL"

# --- 1. POMOCNIKI ---
def to_f(val):
    try:
        if hasattr(val, 'iloc'): val = val.iloc[0]
        if val is None or math.isnan(val) or math.isinf(val): return 0.0
        return float(val)
    except:
        return 0.0


# --- 2. BRAKUJĄCA FUNKCJA S/R ---
def find_enhanced_sr_levels(df):
    """Szuka szczytów i dołków, a następnie grupuje je w strefy."""
    raw_pivots = []
    # Analizujemy ostatnie 500 świec
    data = df.tail(TAIL_SIZE)
    for i in range(2, len(data) - 2):
        # Szczyt (Pivot High)
        if data['High'].iloc[i] == data['High'].iloc[i - 2:i + 3].max():
            raw_pivots.append(to_f(data['High'].iloc[i]))
        # Dołek (Pivot Low)
        if data['Low'].iloc[i] == data['Low'].iloc[i - 2:i + 3].min():
            raw_pivots.append(to_f(data['Low'].iloc[i]))

    if not raw_pivots: return []
    raw_pivots.sort()

    merged_levels = []
    g = [raw_pivots[0]]

    for p in raw_pivots[1:]:
        current_avg = sum(g) / len(g)
        if abs(p - current_avg) <= TOLERANCE:
            g.append(p)
        else:
            merged_levels.append({'price': round(sum(g) / len(g), 1), 'strength': len(g)})
            g = [p]
    if g:
        merged_levels.append({'price': round(sum(g) / len(g), 1), 'strength': len(g)})

    return [l for l in merged_levels if l['strength'] >= 3]


# --- 3. LOGIKA BREAKOUTS I ADR (BEZ ZMIAN) ---
def detect_breakouts(df, levels_list):
    markers = []
    if not levels_list: return []
    try:
        check_range = 9999999
        start_idx = max(1, len(df) - check_range)
        latest_signals = {}
        for lvl in levels_list:
            p = lvl['price']
            for i in range(start_idx, len(df)):
                curr_c = to_f(df['Close'].iloc[i]);
                prev_c = to_f(df['Close'].iloc[i - 1])
                t = int(df.index[i].timestamp())
                if prev_c <= p and curr_c > p:
                    latest_signals[p] = {"time": t, "position": "belowBar", "color": "#26a69a", "shape": "circle",
                                         "text": "BUY"}
                elif prev_c >= p and curr_c < p:
                    latest_signals[p] = {"time": t, "position": "aboveBar", "color": "#ef5350", "shape": "circle",
                                         "text": "SELL"}
        markers = list(latest_signals.values())
        markers.sort(key=lambda x: x['time'])
    except:
        pass
    return markers


def calculate_adr_status(df):
    try:
        if df is None or df.empty: return {"adr": 0.0, "today_range": 0.0, "usage": 0.0, "h_limit": 0, "l_limit": 0}

        d = df.copy()
        d['d'] = d.index.date
        daily = d.groupby('d').agg({'High': 'max', 'Low': 'min', 'Close': 'last'})
        daily['r'] = daily['High'] - daily['Low']

        if len(daily) < 2: return {"adr": 0.0, "today_range": 0.0, "usage": 0.0, "h_limit": 0, "l_limit": 0}

        # Średni zasięg z 14 dni
        adr_val = to_f(daily['r'].iloc[:-1].tail(14).mean())

        # Cena zamknięcia z poprzedniej sesji (punkt bazowy dla linii)
        prev_close = to_f(daily['Close'].iloc[-2])

        # Dzisiejszy zasięg
        t_high = to_f(daily['High'].iloc[-1])
        t_low = to_f(daily['Low'].iloc[-1])
        t_range = t_high - t_low
        usage = (t_range / adr_val * 100) if adr_val > 0 else 0.0

        # Wyliczamy linie ADR od ceny zamknięcia
        # Formula: $Limit = Close_{prev} \pm ADR$
        return {
            "adr": round(adr_val, 1),
            "today_range": round(t_range, 1),
            "usage": round(to_f(usage), 1),
            "h_limit": round(prev_close + adr_val, 1),
            "l_limit": round(prev_close - adr_val, 1)
        }
    except Exception as e:
        print(f"ADR Error: {e}")
        return {"adr": 0.0, "today_range": 0.0, "usage": 0.0, "h_limit": 0, "l_limit": 0}


# --- 4. GŁÓWNY SILNIK DANYCH ---
def get_market_data():
    """
    Główna funkcja pobierająca dane rynkowe, obliczająca wskaźniki i zwracająca strukturę dla frontend'u.
    """
    try:
        ticker = yf.Ticker("WIG20.WA")

        # Pobieranie danych historycznych
        # Używamy "15m" dla interwału M15 (spójność z nazwą zmiennej) i "1h" dla H1
        df_15m = ticker.history(period=PERIOD_M15, interval="1m")
        df_1h = ticker.history(period=PERIOD_H1, interval="5m")

        if df_15m.empty or df_1h.empty:
            print("⚠️ Brak danych dla WIG20.WA")
            return None

        # Obsługa MultiIndex (częsty przypadek w nowszych wersjach yfinance)
        if isinstance(df_15m.columns, pd.MultiIndex): df_15m.columns = df_15m.columns.get_level_values(0)
        if isinstance(df_1h.columns, pd.MultiIndex): df_1h.columns = df_1h.columns.get_level_values(0)

        # --- 1. Wykrywanie poziomów S/R (Support/Resistance) ---
        # Funkcja zdefiniowana w api.py
        lvls_15m = find_enhanced_sr_levels(df_15m)
        lvls_1h = find_enhanced_sr_levels(df_1h)

        # --- 2. Wykrywanie struktury filtrowanej przez S/R ---
        # Funkcja importowana z src/indicators/indicators.py
        structure_m15 = detect_filtered_structure(df_15m, lvls_15m, window=3)
        structure_h1 = detect_filtered_structure(df_1h, lvls_1h, window=3)

        # --- 3. Wykrywanie standardowych wybić (Breakouts) ---
        # Funkcja zdefiniowana w api.py
        sr_markers_15m = detect_breakouts(df_15m, lvls_15m)
        sr_markers_h1 = detect_breakouts(df_1h, lvls_1h)

        # --- 4. Łączenie i sortowanie markerów ---
        # Łączymy markery wybić i struktury w jedną listę dla wykresu
        all_markers_15m = sr_markers_15m + structure_m15
        all_markers_15m.sort(key=lambda x: x['time'])

        all_markers_h1 = sr_markers_h1 + structure_h1
        all_markers_h1.sort(key=lambda x: x['time'])

        # --- 5. Obliczanie Trend Bias (Sentymentu) ---
        # Analiza na podstawie interwału H1
        bias = get_trend_bias(df_1h, lvls_1h, all_markers_h1)

        # --- 6. Zwracanie gotowego obiektu danych ---
        return {
            "m15": {
                "history": [{"time": int(i.timestamp()),
                             "open": to_f(r['Open']),
                             "high": to_f(r['High']),
                             "low": to_f(r['Low']),
                             "close": to_f(r['Close'])} for i, r in df_15m.iterrows()],
                "levels": lvls_15m,
                "markers": all_markers_15m,
                "adr": calculate_adr_status(df_15m)  # ADR obliczamy dla niższego interwału
            },
            "h1": {
                "history": [{"time": int(i.timestamp()),
                             "open": to_f(r['Open']),
                             "high": to_f(r['High']),
                             "low": to_f(r['Low']),
                             "close": to_f(r['Close'])} for i, r in df_1h.iterrows()],
                "levels": lvls_1h,
                "markers": all_markers_h1
            },
            "bias": bias
        }
    except Exception as e:
        print(f"❌ Error w get_market_data: {e}")
        return None


# --- 5. FASTAPI I WEBSOCKET ---
state = {"m15": None, "h1": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def poller():
        while True:
            data = get_market_data()
            if data:
                state.update(data)
                await manager.broadcast({
                    "type": "UPDATE",
                    "candle": data["m15"]["history"][-1],
                    "markers": data["m15"]["markers"],
                    "adr": data["m15"]["adr"],
                    "bias": data["bias"]  # <--- Ważne!
                })
            await asyncio.sleep(60)

    task = asyncio.create_task(poller());
    yield;
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"])


class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active_connections.remove(ws)

    async def broadcast(self, m: dict):
        for c in self.active_connections:
            try:
                await c.send_json(m)
            except:
                pass


manager = ConnectionManager()


@app.get("/api/v1/history")
async def get_history(): return state


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)