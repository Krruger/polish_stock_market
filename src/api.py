import asyncio
import yfinance as yf
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Parametry
MIN_STRENGTH_THRESHOLD = 3
TOLERANCE = 20.0


def find_enhanced_sr_levels(df):
    raw_pivots = []
    for i in range(2, len(df) - 2):
        if df['High'].iloc[i] > df['High'].iloc[i - 1] and df['High'].iloc[i] > df['High'].iloc[i - 2] and \
                df['High'].iloc[i] > df['High'].iloc[i + 1] and df['High'].iloc[i] > df['High'].iloc[i + 2]:
            raw_pivots.append(df['High'].iloc[i])
        if df['Low'].iloc[i] < df['Low'].iloc[i - 1] and df['Low'].iloc[i] < df['Low'].iloc[i - 2] and \
                df['Low'].iloc[i] < df['Low'].iloc[i + 1] and df['Low'].iloc[i] < df['Low'].iloc[i + 2]:
            raw_pivots.append(df['Low'].iloc[i])

    if not raw_pivots: return []
    raw_pivots.sort()

    merged_levels = []
    if raw_pivots:
        current_group = [raw_pivots[0]]
        for i in range(1, len(raw_pivots)):
            avg_group = sum(current_group) / len(current_group)
            if abs(raw_pivots[i] - avg_group) <= TOLERANCE:
                current_group.append(raw_pivots[i])
            else:
                merged_levels.append(
                    {'price': round(sum(current_group) / len(current_group), 1), 'strength': len(current_group)})
                current_group = [raw_pivots[i]]
        merged_levels.append(
            {'price': round(sum(current_group) / len(current_group), 1), 'strength': len(current_group)})

    levels = [lvl for lvl in merged_levels if lvl['strength'] >= MIN_STRENGTH_THRESHOLD]
    print(f"📊 Znaleziono poziomów S/R: {len(levels)}")
    return levels


def detect_smart_breakouts(df, levels_list):
    latest_breakouts = {}

    for lvl in levels_list:
        price = lvl['price']
        for i in range(1, len(df)):
            curr = df['Close'].iloc[i]
            prev = df['Close'].iloc[i - 1]
            time_unix = int(df.index[i].timestamp())

            # Elastyczniejszy warunek przebicia (Cross Over)
            if prev < price and curr > price:
                latest_breakouts[price] = {
                    "time": time_unix, "position": "belowBar",
                    "color": "#26a69a", "shape": "circle", "text": "LATEST BUY"
                }
            # Elastyczniejszy warunek przebicia (Cross Under)
            elif prev > price and curr < price:
                latest_breakouts[price] = {
                    "time": time_unix, "position": "aboveBar",
                    "color": "#ef5350", "shape": "circle", "text": "LATEST SELL"
                }

    markers = list(latest_breakouts.values())
    # Sortowanie markerów po czasie (wymagane przez Lightweight Charts)
    markers.sort(key=lambda x: x['time'])
    print(f"🎯 Wygenerowano unikalnych markerów: {len(markers)}")
    return markers


def get_market_data():
    try:
        ticker = yf.Ticker("WIG20.WA")
        df = ticker.history(period="90d", interval="1h")
        if df.empty: return None

        levels_data = find_enhanced_sr_levels(df)
        markers = detect_smart_breakouts(df, levels_data)

        history = [{"time": int(i.timestamp()), "open": float(r['Open']), "high": float(r['High']),
                    "low": float(r['Low']), "close": float(r['Close'])} for i, r in df.iterrows()]

        return {"history": history, "levels": levels_data, "markers": markers}
    except Exception as e:
        print(f"❌ Błąd pobierania danych: {e}")
        return None


state = {"history": [], "levels": [], "markers": []}


async def data_poller():
    while True:
        data = get_market_data()
        if data:
            state.update(data)
            await manager.broadcast({
                "type": "UPDATE",
                "candle": data["history"][-1],
                "markers": data["markers"]
            })
        await asyncio.sleep(60)  # Odświeżaj częściej dla testów


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(data_poller());
    yield;
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
        for c in self.active_connections:
            try:
                await c.send_json(msg)
            except:
                pass


manager = ConnectionManager()


@app.get("/api/v1/history")
async def get_history(): return state


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket);
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)