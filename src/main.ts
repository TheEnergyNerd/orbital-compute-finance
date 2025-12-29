import './styles/main.css';
import { subscribe, getParams } from './state/store';
import { runScenario } from './model/computeAll';
import { initCharts, updateCharts } from './charts/manager';
import { initSliders } from './ui/sliders';
import { initTabs } from './ui/tabs';
import { updateKPIs, updateToggleEffects, updateFuturesKPIs } from './ui/kpis';

function update(): void {
  const params = getParams();

  // Run all scenarios
  const agg = runScenario('aggressive', params);
  const base = runScenario('baseline', params);
  const cons = runScenario('conservative', params);

  // Update charts
  updateCharts(agg, base, cons, params);

  // Update KPIs
  updateKPIs(base, base.gnds, base.fleets, base.sats, params);
  updateToggleEffects(params);
  updateFuturesKPIs(agg, base, cons);
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI
  initSliders();
  initTabs();
  initCharts();

  // Subscribe to state changes
  subscribe(update);

  // Initial update
  update();

  // Expose for debugging
  (window as unknown as Record<string, unknown>).sim = {
    getParams,
    runScenario,
    update
  };
});
