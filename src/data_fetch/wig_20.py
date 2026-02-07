import yfinance as yf
import pandas as pd


def get_intraday_wig20(interval='1m', period='1d'):
    """
    Pobiera dane intraday dla WIG20.
    interval: '1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'
    period: '1d' (dzisiaj), '5d' (ostatnie 5 dni)
    """
    print(f"Pobieram dane intraday ({interval}) dla WIG20...")

    try:
        # Pobieramy dane dla indeksu WIG20
        # Yahoo Finance ma 15 min opóźnienia dla GPW
        ticker = yf.Ticker("WIG20.WA")

        # Pobranie historii intraday
        df = ticker.history(period=period, interval=interval)

        if df.empty:
            print("Brak danych. Sprawdź czy sesja GPW trwa lub czy symbol jest poprawny.")
            return None

        # Czyszczenie i formatowanie
        df = df.reset_index()
        # Zmiana nazwy kolumny czasu na 'time' dla kompatybilności z wykresami
        df.rename(columns={
            'Datetime': 'time',
            'Open': 'open',
            'High': 'high',
            'Low': 'low',
            'Close': 'close',
            'Volume': 'volume'
        }, inplace=True)

        # Konwersja czasu na format Unix Timestamp (sekundy) - tego wymaga Lightweight Charts
        df['time'] = df['time'].apply(lambda x: int(x.timestamp()))

        return df[['time', 'open', 'high', 'low', 'close', 'volume']]

    except Exception as e:
        print(f"Błąd yfinance: {e}")
        return None


# --- PRZYGOTOWANIE DANYCH DLA FRONTENDU ---
def get_chart_json():
    df = get_intraday_wig20(interval='1m', period='5d')
    if df is not None:
        # Zwracamy listę słowników (format JSON)
        return df.to_dict(orient='records')
    return []


# Test
if __name__ == "__main__":
    data = get_chart_json()
    if data:
        print(f"Pobrano {len(data)} świec intraday.")
        print(f"Ostatnia świeca: {data[-1]}")