import { gameState } from '../engine/state.js';
import { runDaySimulation } from '../engine/simulation.js';

// 1. Tab Navigation
const tabs = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    views.forEach(v => v.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
  });
});

// 2. Render Map Grid
const mapGrid = document.getElementById('map-grid');
if (mapGrid && gameState.map && gameState.map.tiles) {
  gameState.map.tiles.forEach(tile => {
    const el = document.createElement('div');
    el.className = `tile ${tile.type}`;
    el.textContent = tile.slotType ? `[${tile.slotType}]` : tile.type;
    mapGrid.appendChild(el);
  });
}

// 3. Update Top Bar UI
function updateUI() {
  document.getElementById('ui-day').textContent = gameState.day;
  document.getElementById('ui-gold').textContent = Math.round(gameState.gold);
  document.getElementById('ui-rep').textContent = gameState.reputation;
}

// 4. Handle Ticket Price Input
const ticketInput = document.getElementById('ticket-price');
if (ticketInput) {
  ticketInput.value = gameState.ticketPrice;
  ticketInput.addEventListener('change', (e) => {
    gameState.ticketPrice = parseFloat(e.target.value) || 0;
  });
}

// 5. Run Day Button
const runBtn = document.getElementById('btn-run-day');
const reportBox = document.getElementById('day-report');

if (runBtn) {
  runBtn.addEventListener('click', () => {
    const result = runDaySimulation();
    updateUI();

    reportBox.classList.remove('hidden');
    reportBox.innerHTML = `
      <h3>Day ${gameState.day - 1} Summary</h3>
      <p><strong>Attendance:</strong> ${result.attendance} guests</p>
      <p><strong>Ticket Sales:</strong> $${result.ticketRevenue.toFixed(2)}</p>
      <p><strong>Vendor Fees/Cuts:</strong> $${result.vendorRevenue.toFixed(2)}</p>
      <p><strong>Performer Payroll:</strong> -$${result.performerExpenses.toFixed(2)}</p>
      <hr>
      <p><strong>Net Profit:</strong> $${result.netProfit.toFixed(2)}</p>
    `;
  });
}

// Initial UI Refresh
updateUI();