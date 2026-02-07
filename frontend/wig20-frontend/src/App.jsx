import TradingChart from './TradingChart';

function App() {
  return (
    <div style={{ backgroundColor: '#131722', minHeight: '100vh', padding: '20px' }}>
      <h1 style={{ color: 'white', fontFamily: 'sans-serif' }}>WIG20 Live Monitor (15m delay)</h1>
      <div style={{ border: '1px solid #2B2B43', borderRadius: '8px', overflow: 'hidden' }}>
        <TradingChart />
      </div>
    </div>
  );
}

export default App;