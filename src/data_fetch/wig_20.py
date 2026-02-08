import asyncio
import yfinance as yf
import pandas as pd
import numpy as np  # Potrzebne do obliczeń
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager


# --- NOWA LOGIKA: WYKRYWANIE FORMACJI ---
def detect_patterns(df, levels):
    """Analizuje świece i tworzy markery dla wykresu"""
    markers = []
    tolerance = 5.0  # Tolerancja w punktach (dla WIG20 ok. 5 pkt to dobra strefa)

    for index, row in df.iterrows():
        time_unix = int(index.timestamp())

        # Obliczenia geometrii świecy
        body_size = abs(row['Close'] - row['Open'])
        full_range = row['High'] - row['Low']
        upper_wick = row['High'] - max(row['Open'], row['Close'])
        lower_wick = min(row['Open'], row['Close']) - row['Low']

        # Zabezpieczenie przed dzieleniem przez zero (płaskie świece)
        if full_range == 0: continue

        # --- 1. PIN BARY PRZY POZIOMACH ---
        # Bearish Pin Bar (Spadkowy) przy Opórze (Daily High)
        if (row['High'] >= levels['daily_high'] - tolerance) and \
                (upper_wick > 2 * body_size) and (upper_wick > 0.5 * full_range):
            markers.append({
                "time": time_unix, "position": "aboveBar", "color": "#ef5350",
                "shape": "arrowDown", "text": "Pin Bar (Res)"
            })

        # Bullish Pin Bar (Wzrostowy) przy Wsparciu (Daily Low)
        elif (row['Low'] <= levels['daily_low'] + tolerance) and \
                (lower_wick > 2 * body_size) and (lower_wick > 0.5 * full_range):
            markers.append({
                "time": time_unix, "position": "belowBar", "color": "#26a69a",
                "shape": "arrowUp", "text": "Pin Bar (Sup)"
            })

        # --- 2. FBO (FAKE BREAKOUTS) ---
        # Fake Breakout Górą (Wybicie High i powrót)
        elif (row['High'] > levels['daily_high']) and (row['Close'] < levels['daily_high']):
            markers.append({
                "time": time_unix, "position": "aboveBar", "color": "#FF9800",
                "shape": "arrowDown", "text": "FBO?"
            })

        # Fake Breakout Dołem (Wybicie Low i powrót)
        elif (row['Low'] < levels['daily_low']) and (row['Close'] > levels['daily_low']):
            markers.append({
                "time": time_unix, "position": "belowBar", "color": "#FF9800",
                "shape": "arrowUp", "text": "FBO?"
            })

    return markers


# --- LOGIKA DANYCH RYNKOWYCH ---
def identify_levels(df):
    """Wyznacza kluczowe poziomy sesyjne"""
    return {
        # Używamy max/min z całej pobranej historii (5 dni) jako przybliżenie ważnych stref
        "daily_high": float(df['High'].max()),
        "daily_low": float(df['Low'].min()),
        # W wersji PRO liczylibyśmy to tylko dla bieżącego dnia
    }


def get_market_data():
    try:
        ticker = yf.Ticker("WIG20.WA")
        # Pobieramy 5 dni, interwał 5m jest lepszy do swingów i czystszych formacji
        df = ticker.history(period="30d", interval="1h")
        if df.empty: return None

        levels = identify_levels(df)
        # TUTAJ wywołujemy nową funkcję:
        markers = detect_patterns(df, levels)

        formatted_history = []
        for index, row in df.iterrows():
            formatted_history.append({
                "time": int(index.timestamp()),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
            })
        # Zwracamy historię, poziomy ORAZ markery
        return {"history": formatted_history, "levels": levels, "markers": markers}
    except Exception as e:
        print(f"Błąd: {e}")
        return None


# --- FASTAPI SETUP ---
# Stan globalny przechowuje teraz też markery
state = {"history": [], "levels": {}, "markers": []}


async def data_poller():
    while True:
        data = get_market_data()
        if data:
            state["history"] = data["history"]
            state["levels"] = data["levels"]
            state["markers"] = data["markers"]  # Zapisujemy markery

            # W WebSockecie wysyłamy tylko ostatnią świecę, poziomy nie zmieniają się co minutę
            await manager.broadcast({
                "type": "UPDATE",
                "candle": data["history"][-1]
            })
        # Yahoo ma 15m opóźnienia, odświeżanie co 5 minut wystarczy dla interwału 5m
        await asyncio.sleep(300)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(data_poller())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active_connections.remove(ws)

    async def broadcast(self, msg: dict):
        for conn in self.active_connections:
            try:
                await conn.send_json(msg)
            except:
                pass


manager = ConnectionManager()


@app.get("/api/v1/history")
async def get_history():
    # Zwracamy pełny stan przy pierwszym załadowaniu
    return state


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)