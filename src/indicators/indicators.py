def detect_structure(df, window=2):
    """
    Wykrywa lokalne szczyty i dołki.
    window: ile świec z lewej i prawej musi być niższych/wyższych.
    """
    structure_markers = []

    for i in range(window, len(df) - window):
        # Detekcja Szczytu (Peak)
        if df['High'].iloc[i] == df['High'].iloc[i - window: i + window + 1].max():
            structure_markers.append({
                "time": int(df.index[i].timestamp()),
                "position": "aboveBar",
                "color": "#ffffff",  # Biały dla przejrzystości
                "shape": "arrowDown",
                "text": "H",  # High
                "size": 1
            })

        # Detekcja Dołka (Valley)
        if df['Low'].iloc[i] == df['Low'].iloc[i - window: i + window + 1].min():
            structure_markers.append({
                "time": int(df.index[i].timestamp()),
                "position": "belowBar",
                "color": "#ffffff",
                "shape": "arrowUp",
                "text": "L",  # Low
                "size": 1
            })

    return structure_markers


import os

# Pobieramy tolerancję z .env
SR_PROXIMITY = float(os.getenv("SR_PROXIMITY_TOLERANCE", 3.0))


def detect_filtered_structure(df, sr_levels, window=3):
    """
    Zaznacza szczyty i dołki TYLKO w okolicach poziomów S/R.
    sr_levels: lista słowników [{'price': ..., 'strength': ...}]
    """
    structure_markers = []

    # Wyciągamy same ceny poziomów dla łatwiejszego porównania
    sr_prices = [lvl['price'] for lvl in sr_levels]

    for i in range(window, len(df) - window):
        is_high = df['High'].iloc[i] == df['High'].iloc[i - window: i + window + 1].max()
        is_low = df['Low'].iloc[i] == df['Low'].iloc[i - window: i + window + 1].min()

        if is_high or is_low:
            price_to_check = df['High'].iloc[i] if is_high else df['Low'].iloc[i]

            # Sprawdzamy, czy cena szczytu/dołka jest blisko dowolnego poziomu S/R
            is_near_sr = any(abs(price_to_check - sr_p) <= SR_PROXIMITY for sr_p in sr_prices)

            if is_near_sr:
                structure_markers.append({
                    "time": int(df.index[i].timestamp()),
                    "position": "aboveBar" if is_high else "belowBar",
                    "color": "#ffffff",  # Biały dla struktury
                    "shape": "arrowDown" if is_high else "arrowUp",
                    "text": "SR H" if is_high else "SR L",  # "SR" oznacza potwierdzenie poziomu
                    "size": 1
                })

    return structure_markers


def calculate_rsi(df, period=14):
    """Oblicza wskaźnik RSI."""
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()

    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))

    # Przygotowanie danych pod Lightweight Charts
    return [{"time": int(i.timestamp()), "value": float(v)}
            for i, v in rsi.dropna().items()]