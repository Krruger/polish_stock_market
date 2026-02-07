import io

import pandas as pd
import requests

URL = "https://stooq.pl/q/d/l/?s=fw20&i=5"
df = pd.read_csv(URL)

ticker = "WIG20"

url = f"https://stooq.pl/q/d/l/?s={ticker}&i=5"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/csv,text/plain,*/*',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://stooq.pl/'
}
response = requests.get(url, headers=headers, timeout=30)
x = pd.read_csv(io.StringIO(response.text), parse_dates=['Data'], index_col='Data')
x.to_csv("ABC.csv")

import yfinance as yf

df = yf.download(
    "^WIG20",
    interval="1d",
    period="1y"
)