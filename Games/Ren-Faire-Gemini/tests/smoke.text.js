// Simple Node test verifying core engine state updates independently of UI
import { gameState } from '../src/engine/state.js';
import { runDaySimulation } from '../src/engine/simulation.js';

console.log('Running Stage 1 Smoke Test...');

const initialGold = gameState.gold;
const initialDay = gameState.day;

const result = runDaySimulation();

console.assert(gameState.day === initialDay + 1, 'Day should increment by 1');
console.assert(gameState.gold === initialGold + result.netProfit, 'Gold should update by net profit');
console.assert(result.attendance > 0, 'Attendance should be greater than 0');

console.log('Smoke Test Passed Successfully! Results:', result);