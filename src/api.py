import asyncio
import yfinance as yf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import List

app = FastAPI()

# Dodajemy CORS, żeby React mógł się połączyć
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- PRZECHOWYWANIE DANYCH W PAMIĘCI ---
# Przechowujemy ostatnie pobrane świece, żeby nowi użytkownicy od razu widzieli wykres
state = {
    "history": [],
    "last_timestamp": 0
}


# --- LOGIKA POBIERANIA DANYCH ---
def fetch_wig20_data():
    """Pobiera dane 1-minutowe dla WIG20 z Yahoo Finance"""
    try:
        ticker = yf.Ticker("WIG20.WA")
        # Pobieramy ostatni 1 dzień z interwałem 1m
        df = ticker.history(period="5d", interval="1m")
        if df.empty:
            return None

        df = df.reset_index()
        print(df)
        # Konwersja do formatu akceptowanego przez Lightweight Charts
        formatted_data = []
        for _, row in df.iterrows():
            formatted_data.append({
                "time": int(row['Datetime'].timestamp()),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
                "volume": int(row['Volume'])
            })
        return formatted_data
    except Exception as e:
        print(f"Błąd pobierania danych: {e}")
        return None


# --- MANAGER WEBSOCKET ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


# --- POLLER (ZADANIE W TLE) ---
async def data_poller():
    """Pętla co 60 sekund sprawdza nowe dane i wysyła je przez WebSocket"""
    print("Uruchomiono poller danych...")
    while True:
        new_data = fetch_wig20_data()

        if new_data:
            state["history"] = new_data
            latest_candle = new_data[-1]

            # Jeśli mamy nową świecę (inny timestamp niż ostatnio)
            if latest_candle["time"] > state["last_timestamp"]:
                state["last_timestamp"] = latest_candle["time"]
                print(
                    f"Nowa świeca: {datetime.fromtimestamp(state['last_timestamp'])} | Close: {latest_candle['close']}")

                # Rozsyłamy informację do wszystkich połączonych traderów
                await manager.broadcast({
                    "type": "UPDATE",
                    "candle": latest_candle
                })

        # Czekamy 60 sekund (Yahoo Finance odświeża dane z opóźnieniem 15 min,
        # ale co minutę pojawia się nowa "opóźniona" świeca)
        await asyncio.sleep(60)


# --- START POLLERA PRZY URUCHOMIENIU SERWERA ---
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(data_poller())


# --- ENDPOINTY API ---

@app.get("/api/v1/history")
async def get_history():
    """Zwraca całą historię sesji (używane przy ładowaniu strony)"""
    if not state["history"]:
        data = fetch_wig20_data()
        if data:
            state["history"] = data
    return state["history"]


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Kanał dla danych w czasie rzeczywistym"""
    await manager.connect(websocket)
    try:
        while True:
            # Utrzymujemy połączenie (heartbeat)
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)