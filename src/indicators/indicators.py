import pandas as pd
import numpy as np


def to_f(val):
    try:
        return float(val)
    except:
        return 0.0


def calculate_rsi(df, period=14):
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return [{"time": int(i.timestamp()), "value": to_f(v)} for i, v in rsi.dropna().items()]


def find_sr_levels(df, sensitivity=100):
    levels = []
    for i in range(sensitivity, len(df) - sensitivity):
        if df['High'].iloc[i] == df['High'].iloc[i - sensitivity:i + sensitivity + 1].max():
            levels.append({"price": to_f(df['High'].iloc[i]), "strength": 5})
        if df['Low'].iloc[i] == df['Low'].iloc[i - sensitivity:i + sensitivity + 1].min():
            levels.append({"price": to_f(df['Low'].iloc[i]), "strength": 5})

    unique_levels = []
    if levels:
        levels.sort(key=lambda x: x['price'])
        curr = levels[0]
        for i in range(1, len(levels)):
            if abs(levels[i]['price'] - curr['price']) < 5:
                curr['strength'] += 1
            else:
                unique_levels.append(curr)
                curr = levels[i]
        unique_levels.append(curr)
    return unique_levels


def detect_filtered_structure(df, levels, window=3, proximity=5.0):
    markers = []
    for i in range(window, len(df) - window):
        h, l = df['High'].iloc[i], df['Low'].iloc[i]
        t = int(df.index[i].timestamp())
        if h == df['High'].iloc[i - window:i + window + 1].max():
            if any(abs(h - lvl['price']) <= proximity for lvl in levels):
                markers.append(
                    {"time": t, "position": "aboveBar", "color": "#ffffff", "shape": "arrowDown", "text": "H-lvl"})
        if l == df['Low'].iloc[i - window:i + window + 1].min():
            if any(abs(l - lvl['price']) <= proximity for lvl in levels):
                markers.append(
                    {"time": t, "position": "belowBar", "color": "#ffffff", "shape": "arrowUp", "text": "L-lvl"})
    return markers


def detect_breakouts(df, levels):
    markers = []
    for i in range(1, len(df)):
        c, prev_c = df['Close'].iloc[i], df['Close'].iloc[i - 1]
        t = int(df.index[i].timestamp())
        for lvl in levels:
            if prev_c <= lvl['price'] < c:
                markers.append(
                    {"time": t, "position": "belowBar", "color": "#26a69a", "shape": "circle", "text": "BUY"})
            elif prev_c >= lvl['price'] > c:
                markers.append(
                    {"time": t, "position": "aboveBar", "color": "#ef5350", "shape": "circle", "text": "SELL"})
    return markers