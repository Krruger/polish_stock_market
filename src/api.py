import asyncio
import yfinance as yf
import pandas as pd
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager


# --- 1. POMOCNIK: BEZPIECZNA KONWERSJA NA FLOAT ---
def to_f(val):
    try:
        # Obsługa Series z yfinance
        if hasattr(val, 'iloc'): val = val.iloc[0]
        if val is None or math.isnan(val) or math.isinf(val): return 0.0
        return float(val)
    except:
        return 0.0


# --- 2. LOGIKA WYKRYWANIA WYBIĆ (BREAKOUTS) ---
def detect_breakouts(df, levels_list):
    """Szuka momentów, w których cena przebija poziomy S/R."""
    markers = []
    if not levels_list: return []

    try:
        # Patrzymy na ostatnie 100 świeczek
        check_range = 99999999
        start_idx = max(1, len(df) - check_range)
        latest_signals = {}

        for lvl in levels_list:
            p = lvl['price']
            for i in range(start_idx, len(df)):
                curr_c = to_f(df['Close'].iloc[i])
                prev_c = to_f(df['Close'].iloc[i - 1])
                t = int(df.index[i].timestamp())

                # Wybicie w górę
                if prev_c <= p and curr_c > p:
                    latest_signals[p] = {
                        "time": t, "position": "belowBar",
                        "color": "#26a69a", "shape": "circle", "text": "BUY"
                    }
                # Wybicie w dół
                elif prev_c >= p and curr_c < p:
                    latest_signals[p] = {
                        "time": t, "position": "aboveBar",
                        "color": "#ef5350", "shape": "circle", "text": "SELL"
                    }

        markers = list(latest_signals.values())
        markers.sort(key=lambda x: x['time'])  # Ważne dla Lightweight Charts
    except Exception as e:
        print(f"❌ Błąd markerów: {e}")
    return markers


# --- 3. LOGIKA ADR (ZMIENNOŚĆ) ---
def calculate_adr_status(df):
    try:
        if df is None or df.empty: return {"adr": 0.0, "today_range": 0.0, "usage": 0.0}

        d = df.copy()
        d['d'] = d.index.date
        daily = d.groupby('d').agg({'High': 'max', 'Low': 'min'})
        daily['r'] = daily['High'] - daily['Low']

        if len(daily) < 2: return {"adr": 0.0, "today_range": 0.0, "usage": 0.0}

        # ADR(14) - średnia z sesji bez dzisiejszej
        adr_val = to_f(daily['r'].iloc[:-1].tail(14).mean())
        t_range = to_f(daily['High'].iloc[-1] - daily['Low'].iloc[-1])
        usage = (t_range / adr_val * 100) if adr_val > 0 else 0.0

        return {
            "adr": round(adr_val, 1),
            "today_range": round(t_range, 1),
            "usage": round(to_f(usage), 1)
        }
    except:
        return {"adr": 0.0, "today_range": 0.0, "usage": 0.0}


# --- 4. GŁÓWNY SILNIK DANYCH ---
def get_market_data():
    try:
        ticker = yf.Ticker("WIG20.WA")
        df = ticker.history(period="30d", interval="15m")
        if df.empty: return None
        if isinstance(df.columns, pd.MultiIndex): df.columns = df.columns.get_level_values(0)

        # Poziomy S/R
        raw = []
        rec = df.tail(500)
        for i in range(2, len(rec) - 2):
            if rec['High'].iloc[i] == rec['High'].iloc[i - 2:i + 3].max(): raw.append(to_f(rec['High'].iloc[i]))
            if rec['Low'].iloc[i] == rec['Low'].iloc[i - 2:i + 3].min(): raw.append(to_f(rec['Low'].iloc[i]))

        raw.sort()
        lvls = []
        if raw:
            g = [raw[0]]
            for p in raw[1:]:
                if abs(p - sum(g) / len(g)) < 10.0:
                    g.append(p)
                else:
                    lvls.append({'price': round(sum(g) / len(g), 1), 'strength': len(g)})
                    g = [p]
            if g: lvls.append({'price': round(sum(g) / len(g), 1), 'strength': len(g)})

        final_lvls = [l for l in lvls if l['strength'] >= 3]
        markers = detect_breakouts(df, final_lvls)

        return {
            "history": [
                {"time": int(i.timestamp()), "open": to_f(r['Open']), "high": to_f(r['High']), "low": to_f(r['Low']),
                 "close": to_f(r['Close'])} for i, r in df.iterrows()],
            "levels": final_lvls,
            "markers": markers,
            "adr": calculate_adr_status(df)
        }
    except Exception as e:
        print(f"❌ Błąd główny: {e}");
        return None


# --- 5. SETUP FASTAPI I WEBSOCKET ---
state = {"history": [], "levels": [], "markers": [], "adr": {"adr": 0, "today_range": 0, "usage": 0}}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Zadanie w tle, które co 60s pobiera dane i wysyła do wszystkich
    async def poller():
        while True:
            data = get_market_data()
            if data:
                state.update(data)
                await manager.broadcast({
                    "type": "UPDATE",
                    "candle": data["history"][-1],
                    "markers": data["markers"],  # <--- TERAZ KELNER ZABIERA KROPKI!
                    "adr": data["adr"],
                    "levels": data["levels"]
                })
            await asyncio.sleep(60)

    task = asyncio.create_task(poller())
    yield
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
async def get_history():
    return state


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