import asyncio
import yfinance as yf
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager


# --- LOGIKA S/R ---
def identify_levels(df):
    """Wyznacza kluczowe poziomy dla Swing Tradera"""
    levels = {
        "daily_high": float(df['High'].max()),
        "daily_low": float(df['Low'].min()),
        "prev_day_close": float(df['Close'].iloc[0]),  # Przybliżenie dla historycznego Close
    }

    # Szukamy lokalnych szczytów (Fractals) jako bazy pod S/R
    # Jeśli High świecy jest wyższy niż 2 świece przed i po - to jest to opór
    pivots = []
    for i in range(2, len(df) - 2):
        if df['High'].iloc[i] > df['High'].iloc[i - 1] and df['High'].iloc[i] > df['High'].iloc[i + 1]:
            pivots.append({"time": int(df.index[i].timestamp()), "price": float(df['High'].iloc[i]), "type": "RES"})
        if df['Low'].iloc[i] < df['Low'].iloc[i - 1] and df['Low'].iloc[i] < df['Low'].iloc[i + 1]:
            pivots.append({"time": int(df.index[i].timestamp()), "price": float(df['Low'].iloc[i]), "type": "SUP"})

    return levels, pivots


def get_market_data():
    try:
        ticker = yf.Ticker("WIG20.WA")
        df = ticker.history(period="5d", interval="5m")  # Swing lepiej widać na 5m
        if df.empty: return None

        levels, pivots = identify_levels(df)

        formatted = []
        for index, row in df.iterrows():
            formatted.append({
                "time": int(index.timestamp()),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
            })
        return {"history": formatted, "levels": levels, "pivots": pivots}
    except Exception as e:
        print(f"Błąd: {e}")
        return None


# --- FASTAPI ---
state = {"history": [], "levels": {}, "pivots": []}


async def data_poller():
    while True:
        data = get_market_data()
        if data:
            state["history"] = data["history"]
            state["levels"] = data["levels"]
            state["pivots"] = data["pivots"]
            await manager.broadcast({"type": "UPDATE", "candle": data["history"][-1], "levels": data["levels"]})
        await asyncio.sleep(60)


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
async def get_history(): return state


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)