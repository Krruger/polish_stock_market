import asyncio

from src.api import manager
from src.data_fetch.wig_20 import get_chart_json


async def update_data_loop():
    while True:
        data = get_chart_json()
        if data:
            # Tutaj wysyłasz dane przez WebSocket do Reacta
            await manager.broadcast({"type": "UPDATE", "data": data[-1]})  # Tylko ostatnia świeca

        # Czekaj 60 sekund przed kolejnym pobraniem
        await asyncio.sleep(60)