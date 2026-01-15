import Chart from 'chart.js/auto';
import { YEARS } from '../model/constants';
import { getLineOptions, getStackedOptions, COLORS } from './config';
import type { ScenarioResult } from '../model/types';
import type { Params } from '../model/types';
import { getRadiatorMassPerMW, getLaunchCost } from '../model/physics';
import { getShellRadiationEffects } from '../model/orbital';

const charts: Record<string, Chart | null> = {};

/**
 * Sanitize LCOC array by interpolating Infinity values using geometric mean.
 * This prevents Chart.js fill artifacts when one scenario has Infinity.
 */
function sanitizeLcocArray(arr: number[]): number[] {
  const result = arr.map(v => (isFinite(v) && v > 0) ? v : null);
  for (let i = 0; i < result.length; i++) {
    if (result[i] === null) {
      let prev: number | null = null, next: number | null = null;
      let prevIdx = i - 1, nextIdx = i + 1;
      while (prevIdx >= 0 && prev === null) { prev = result[prevIdx]; prevIdx--; }
      while (nextIdx < result.length && next === null) { next = result[nextIdx]; nextIdx++; }
      if (prev !== null && next !== null) {
        result[i] = Math.sqrt(prev * next); // Geometric mean for log scale
      } else if (prev !== null) {
        result[i] = prev;
      } else if (next !== null) {
        result[i] = next;
      }
    }
  }
  return result as number[];
}

/**
 * Conversion factor: Million tokens per GPU-hour
 * 
 * Derivation (Llama-70B class model):
 * - H100 GPU: ~1979 TFLOPS effective
 * - FLOPs per token: 140 GFLOPs (Llama-70B)
 * - Tokens/sec = 1979e12 / 140e9 ≈ 14,136 tokens/sec
 * - Tokens/hour = 14,136 × 3600 ≈ 50.9M tokens/hr
 * 
 * Simplified to 50 for display purposes.
 * To get $/M-tokens from $/GPU-hr: divide LCOC by this value.
 */
const M_TOKENS_PER_GPU_HR = 50;

// Set Chart.js defaults
Chart.defaults.color = '#6b5d4a';
Chart.defaults.borderColor = '#c4b8a4';
Chart.defaults.font.family = 'IBM Plex Sans';

export function initCharts(): void {
  const opts = getLineOptions;
  const stackOpts = getStackedOptions;

  // Core - LCOC with uncertainty bands
  const lcocCanvasIds = ['c-lcoc', 'c-lcoc-world', 'c-lcoc-sandbox'];
  lcocCanvasIds.forEach((id) => {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      charts[id] = new Chart(el, {
        type: 'line',
        data: {
          labels: YEARS,
          datasets: [
            { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.orbital, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.ground, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.ground, borderWidth: 1.5, borderDash: [4, 4], tension: 0.3, pointRadius: 0, label: 'Ground (base)' }
          ]
        },
        options: opts('$/GPU-hr', true)
      });
    }
  });

  // Inference cost (Core + World)
  const inferenceCanvasIds = ['c-inference', 'c-inference-world'];
  inferenceCanvasIds.forEach((id) => {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      charts[id] = new Chart(el, {
        type: 'line',
        data: {
          labels: YEARS,
          datasets: [
            { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.orbital, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.ground, borderWidth: 2, tension: 0.3, pointRadius: 0 },
            { data: [], borderColor: COLORS.ground, borderWidth: 1.5, borderDash: [4, 4], tension: 0.3, pointRadius: 0 }
          ]
        },
        options: opts('$/M tokens', true)
      });
    }
  });

  // Fleet by shell (Core + World)
  const fleetCanvasIds = ['c-fleet', 'c-fleet-world'];
  fleetCanvasIds.forEach((id) => {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      charts[id] = new Chart(el, {
        type: 'line',
        data: {
          labels: YEARS,
          datasets: [
            { data: [], borderColor: COLORS.orbital, backgroundColor: COLORS.orbitalArea, fill: true, tension: 0.3 },
            { data: [], borderColor: COLORS.accent, backgroundColor: COLORS.accentFill, fill: true, tension: 0.3 },
            { data: [], borderColor: COLORS.warning, backgroundColor: COLORS.warningFill, fill: true, tension: 0.3 },
            { data: [], borderColor: COLORS.purple, backgroundColor: COLORS.purpleFill, fill: true, tension: 0.3 }
          ]
        },
        options: { ...opts('TW', true), scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
      });
    }
  });

  // Carbon (Core + World)
  const carbonCanvasIds = ['c-carbon', 'c-carbon-world'];
  carbonCanvasIds.forEach((id) => {
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (el) {
      charts[id] = new Chart(el, {
        type: 'line',
        data: {
          labels: YEARS,
          datasets: [
            { data: [], borderColor: COLORS.orbital, tension: 0.3 },
            { data: [], borderColor: COLORS.ground, tension: 0.3 }
          ]
        },
        options: opts('gCO₂/TFLOP-hr')
      });
    }
  });

  // Supply/Demand
  const supplyDemandEl = document.getElementById('c-supplyDemand') as HTMLCanvasElement | null;
  if (supplyDemandEl) {
    charts.supplyDemand = new Chart(supplyDemandEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.ground, tension: 0.3, borderWidth: 2 },
          { data: [], borderColor: COLORS.muted, borderDash: [4, 4], tension: 0.3 },
          { data: [], borderColor: COLORS.orbital, tension: 0.3, borderWidth: 2 }
        ]
      },
      options: opts('GW', true)
    });
  }

  // Scarcity
  const scarcityEl = document.getElementById('c-scarcity') as HTMLCanvasElement | null;
  if (scarcityEl) {
    charts.scarcity = new Chart(scarcityEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.ground, backgroundColor: COLORS.groundFill, fill: true, tension: 0.3 }
        ]
      },
      options: opts('×')
    });
  }

  // Efficiency
  const efficiencyEl = document.getElementById('c-efficiency') as HTMLCanvasElement | null;
  if (efficiencyEl) {
    charts.efficiency = new Chart(efficiencyEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orbital, tension: 0.3 },
          { data: [], borderColor: COLORS.ground, tension: 0.3 }
        ]
      },
      options: opts('GFLOPS/W', true)
    });
  }

  // Shell utilization
  const shellUtilEl = document.getElementById('c-shellUtil') as HTMLCanvasElement | null;
  if (shellUtilEl) {
    charts.shellUtil = new Chart(shellUtilEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orbital, tension: 0.3 },
          { data: [], borderColor: COLORS.accent, tension: 0.3 },
          { data: [], borderColor: COLORS.warning, tension: 0.3 },
          { data: [], borderColor: COLORS.purple, tension: 0.3 }
        ]
      },
      options: opts('%')
    });
  }

  // Bandwidth
  const bandwidthEl = document.getElementById('c-bandwidth') as HTMLCanvasElement | null;
  if (bandwidthEl) {
    charts.bandwidth = new Chart(bandwidthEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.accent, backgroundColor: 'rgba(58,122,184,0.1)', fill: true, tension: 0.3 }
        ]
      },
      options: opts('Tbps', true)
    });
  }

  // BW Util
  const bwUtilEl = document.getElementById('c-bwUtil') as HTMLCanvasElement | null;
  if (bwUtilEl) {
    charts.bwUtil = new Chart(bwUtilEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orange, backgroundColor: 'rgba(212,98,42,0.1)', fill: true, tension: 0.3 }
        ]
      },
      options: opts('%')
    });
  }

  // Stranded
  const strandedEl = document.getElementById('c-stranded') as HTMLCanvasElement | null;
  if (strandedEl) {
    charts.stranded = new Chart(strandedEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.ground, backgroundColor: COLORS.groundFill, fill: true, tension: 0.3 }
        ]
      },
      options: opts('×')
    });
  }

  // Thermal
  const thermalEl = document.getElementById('c-thermal') as HTMLCanvasElement | null;
  if (thermalEl) {
    charts.thermal = new Chart(thermalEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.ground, backgroundColor: COLORS.groundFill, fill: true, tension: 0.1 }
        ]
      },
      options: opts('kg/kW')
    });
  }

  // EROL
  const erolEl = document.getElementById('c-erol') as HTMLCanvasElement | null;
  if (erolEl) {
    charts.erol = new Chart(erolEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.warning, backgroundColor: 'rgba(212,154,34,0.1)', fill: true, tension: 0.3 }
        ]
      },
      options: opts('×')
    });
  }

  // Bottleneck (stacked bar)
  const bottleneckEl = document.getElementById('c-bottleneck') as HTMLCanvasElement | null;
  if (bottleneckEl) {
    charts.bottleneck = new Chart(bottleneckEl, {
      type: 'bar',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], backgroundColor: COLORS.orangeFill },         // thermal
          { data: [], backgroundColor: 'rgba(212,154,34,0.7)' },    // power
          { data: [], backgroundColor: 'rgba(58,122,184,0.7)' },    // bandwidth
          { data: [], backgroundColor: 'rgba(122,75,168,0.7)' },    // slots
          { data: [], backgroundColor: 'rgba(26,138,106,0.7)' },    // demand
          { data: [], backgroundColor: 'rgba(180,80,80,0.7)' }      // launch_capacity
        ]
      },
      options: stackOpts('Constraint')
    });
  }

  // Power - all 4 shells
  const powerEl = document.getElementById('c-power') as HTMLCanvasElement | null;
  if (powerEl) {
    charts.power = new Chart(powerEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orbital, tension: 0.1, borderWidth: 2 }, // LEO
          { data: [], borderColor: COLORS.accent, tension: 0.1, borderWidth: 2 },  // MEO
          { data: [], borderColor: COLORS.warning, tension: 0.1, borderWidth: 2 }, // GEO
          { data: [], borderColor: COLORS.purple, tension: 0.1, borderWidth: 2 }   // Cislunar
        ]
      },
      options: opts('MW', true)
    });
  }

  // Spec Power
  const specPowerEl = document.getElementById('c-specPower') as HTMLCanvasElement | null;
  if (specPowerEl) {
    charts.specPower = new Chart(specPowerEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orbital, backgroundColor: COLORS.orbitalFill, fill: true, tension: 0.3 }
        ]
      },
      options: opts('W/kg', true)
    });
  }

  // Mass (stacked bar)
  const massEl = document.getElementById('c-mass') as HTMLCanvasElement | null;
  if (massEl) {
    charts.mass = new Chart(massEl, {
      type: 'bar',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], backgroundColor: COLORS.warning },
          { data: [], backgroundColor: COLORS.purple },
          { data: [], backgroundColor: COLORS.orbital },
          { data: [], backgroundColor: COLORS.ground },
          { data: [], backgroundColor: COLORS.muted }
        ]
      },
      options: stackOpts('kg')
    });
  }

  // Power budget (stacked bar)
  const powerBudgetEl = document.getElementById('c-powerBudget') as HTMLCanvasElement | null;
  if (powerBudgetEl) {
    charts.powerBudget = new Chart(powerBudgetEl, {
      type: 'bar',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], backgroundColor: 'rgba(26,138,106,0.7)' },
          { data: [], backgroundColor: COLORS.orangeFill },
          { data: [], backgroundColor: 'rgba(122,122,136,0.7)' }
        ]
      },
      options: stackOpts('%')
    });
  }

  // Launch cost
  const launchEl = document.getElementById('c-launch') as HTMLCanvasElement | null;
  if (launchEl) {
    charts.launch = new Chart(launchEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orange, tension: 0.3 }
        ]
      },
      options: opts('$/kg', true)
    });
  }

  // Data rate
  const dataRateEl = document.getElementById('c-dataRate') as HTMLCanvasElement | null;
  if (dataRateEl) {
    charts.dataRate = new Chart(dataRateEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.accent, backgroundColor: 'rgba(58,122,184,0.1)', fill: true, tension: 0.3 }
        ]
      },
      options: opts('Gbps', true)
    });
  }

  // Reliability
  const reliabilityEl = document.getElementById('c-reliability') as HTMLCanvasElement | null;
  if (reliabilityEl) {
    charts.reliability = new Chart(reliabilityEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.orbital, tension: 0.3, borderWidth: 2 },
          { data: [], borderColor: COLORS.warning, tension: 0.3, borderWidth: 2 },
          { data: [], borderColor: COLORS.accent, tension: 0.3, borderWidth: 2 },
          { data: [], borderColor: COLORS.purple, tension: 0.3, borderWidth: 2 }
        ]
      },
      options: opts('%')
    });
  }

  // Futures - LCOC scenarios
  const lcocScenariosEl = document.getElementById('c-lcocScenarios') as HTMLCanvasElement | null;
  if (lcocScenariosEl) {
    charts.lcocScenarios = new Chart(lcocScenariosEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.orbital, borderWidth: 2, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.ground, borderWidth: 2, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.ground, borderWidth: 1.5, borderDash: [4, 4], tension: 0.3, pointRadius: 0 }
        ]
      },
      options: opts('$/GPU-hr', true)
    });
  }

  // Carbon scenarios
  const carbonScenariosEl = document.getElementById('c-carbonScenarios') as HTMLCanvasElement | null;
  if (carbonScenariosEl) {
    charts.carbonScenarios = new Chart(carbonScenariosEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.orbital, borderWidth: 2, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 }
        ]
      },
      options: opts('gCO₂/TFLOP-hr')
    });
  }

  // Efficiency scenarios
  const effScenariosEl = document.getElementById('c-effScenarios') as HTMLCanvasElement | null;
  if (effScenariosEl) {
    charts.effScenarios = new Chart(effScenariosEl, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.orbital, borderWidth: 2, tension: 0.3, pointRadius: 0 },
          { data: [], borderColor: COLORS.transparent, fill: false, tension: 0.3, pointRadius: 0 }
        ]
      },
      options: opts('GFLOPS/W', true)
    });
  }
}

export function updateCharts(
  agg: ScenarioResult,
  base: ScenarioResult,
  cons: ScenarioResult,
  params: Params
): void {
  const sats = base.sats;
  const gnds = base.gnds;
  const fleets = base.fleets;

  // LCOC charts (Core, World, Sandbox)
  ['c-lcoc', 'c-lcoc-world', 'c-lcoc-sandbox'].forEach((id) => {
    const chart = charts[id];
    if (chart) {
      chart.data.datasets[0].data = sanitizeLcocArray(agg.fleets.map((f) => f.lcocEffective));
      chart.data.datasets[1].data = sanitizeLcocArray(base.fleets.map((f) => f.lcocEffective));
      chart.data.datasets[2].data = sanitizeLcocArray(cons.fleets.map((f) => f.lcocEffective));
      chart.data.datasets[3].data = sanitizeLcocArray(gnds.map((g) => g.market));
      chart.data.datasets[4].data = sanitizeLcocArray(gnds.map((g) => g.base));
      chart.update('none');
    }
  });

  // Inference (Core + World)
  ['c-inference', 'c-inference-world'].forEach((id) => {
    const chart = charts[id];
    if (chart) {
      chart.data.datasets[0].data = sanitizeLcocArray(agg.fleets.map((f) => f.lcocEffective / M_TOKENS_PER_GPU_HR));
      chart.data.datasets[1].data = sanitizeLcocArray(base.fleets.map((f) => f.lcocEffective / M_TOKENS_PER_GPU_HR));
      chart.data.datasets[2].data = sanitizeLcocArray(cons.fleets.map((f) => f.lcocEffective / M_TOKENS_PER_GPU_HR));
      chart.data.datasets[3].data = sanitizeLcocArray(gnds.map((g) => g.market / M_TOKENS_PER_GPU_HR));
      chart.data.datasets[4].data = sanitizeLcocArray(gnds.map((g) => g.base / M_TOKENS_PER_GPU_HR));
      chart.update('none');
    }
  });

  // Fleet (Core + World)
  ['c-fleet', 'c-fleet-world'].forEach((id) => {
    const chart = charts[id];
    if (chart) {
      chart.data.datasets[0].data = fleets.map((f) => f.leoPowerTw);
      chart.data.datasets[1].data = fleets.map((f) => f.meoPowerTw);
      chart.data.datasets[2].data = fleets.map((f) => f.geoPowerTw);
      chart.data.datasets[3].data = fleets.map((f) => f.cisPowerTw);
      chart.update('none');
    }
  });

  // Carbon (Core + World)
  ['c-carbon', 'c-carbon-world'].forEach((id) => {
    const chart = charts[id];
    if (chart) {
      chart.data.datasets[0].data = sats.map((s) => s.carbonPerTflop);
      chart.data.datasets[1].data = gnds.map((g) => g.carbonPerTflop);
      chart.update('none');
    }
  });

  // Supply/Demand
  if (charts.supplyDemand) {
    charts.supplyDemand.data.datasets[0].data = gnds.map((g) => g.demand);
    charts.supplyDemand.data.datasets[1].data = gnds.map((g) => g.groundSupply);
    charts.supplyDemand.data.datasets[2].data = gnds.map((g) => g.totalSupply);
    charts.supplyDemand.update('none');
  }

  // Scarcity
  if (charts.scarcity) {
    charts.scarcity.data.datasets[0].data = gnds.map((g) => g.premium);
    charts.scarcity.update('none');
  }

  // Efficiency
  if (charts.efficiency) {
    charts.efficiency.data.datasets[0].data = sats.map((s) => s.gflopsW);
    charts.efficiency.data.datasets[1].data = gnds.map((g) => g.gflopsW);
    charts.efficiency.update('none');
  }

  // Shell utilization
  if (charts.shellUtil) {
    charts.shellUtil.data.datasets[0].data = fleets.map((f) => f.leoUtil * 100);
    charts.shellUtil.data.datasets[1].data = fleets.map((f) => f.meoUtil * 100);
    charts.shellUtil.data.datasets[2].data = fleets.map((f) => f.geoUtil * 100);
    charts.shellUtil.data.datasets[3].data = fleets.map((f) => f.cisUtil * 100);
    charts.shellUtil.update('none');
  }

  // Bandwidth
  if (charts.bandwidth) {
    charts.bandwidth.data.datasets[0].data = fleets.map((f) => f.bwAvailGbps / 1000);
    charts.bandwidth.update('none');
  }

  // BW Util
  if (charts.bwUtil) {
    charts.bwUtil.data.datasets[0].data = fleets.map((f) => f.bwUtil * 100);
    charts.bwUtil.update('none');
  }

  // Stranded
  if (charts.stranded) {
    charts.stranded.data.datasets[0].data = fleets.map((f) => 1 / Math.max(0.01, f.sellableUtil || 1));
    charts.stranded.update('none');
  }

  // Thermal
  if (charts.thermal) {
    charts.thermal.data.datasets[0].data = sats.map((s) => getRadiatorMassPerMW(s.year, s.powerKw, params) / 1000);
    charts.thermal.update('none');
  }

  // EROL
  if (charts.erol) {
    charts.erol.data.datasets[0].data = sats.map((s) => s.erol);
    charts.erol.update('none');
  }

  // Bottleneck
  if (charts.bottleneck) {
    charts.bottleneck.data.datasets[0].data = fleets.map((f) => (f.bottleneck === 'thermal' ? 1 : 0));
    charts.bottleneck.data.datasets[1].data = fleets.map((f) => (f.bottleneck === 'power' ? 1 : 0));
    charts.bottleneck.data.datasets[2].data = fleets.map((f) => (f.bottleneck === 'bandwidth' ? 1 : 0));
    charts.bottleneck.data.datasets[3].data = fleets.map((f) => (f.bottleneck === 'slots' ? 1 : 0));
    charts.bottleneck.data.datasets[4].data = fleets.map((f) => (f.bottleneck === 'demand' ? 1 : 0));
    charts.bottleneck.data.datasets[5].data = fleets.map((f) => (f.bottleneck === 'launch_capacity' ? 1 : 0));
    charts.bottleneck.update('none');
  }

  // Power - all 4 shells
  if (charts.power) {
    // LEO power
    charts.power.data.datasets[0].data = sats.map((s) => s.powerKw / 1000);
    // MEO power (80% of LEO)
    charts.power.data.datasets[1].data = sats.map((s) => s.powerKw * 0.8 / 1000);
    // GEO power (scales with technology breakthroughs)
    charts.power.data.datasets[2].data = sats.map((s, i) => {
      const year = 2026 + i;
      const hasFission = params.fissionOn && year >= params.fissionYear;
      const hasThermal = params.thermalOn && year >= params.thermalYear;
      const mult = hasFission ? 20 : hasThermal ? 10 : 5;
      return s.powerKw * mult / 1000;
    });
    // Cislunar power
    charts.power.data.datasets[3].data = fleets.map((f) => f.cislunarPowerKw / 1000);
    charts.power.update('none');
  }

  // Spec Power
  if (charts.specPower) {
    charts.specPower.data.datasets[0].data = sats.map((s) => s.specPower);
    charts.specPower.update('none');
  }

  // Mass
  if (charts.mass) {
    charts.mass.data.datasets[0].data = sats.map((s) => s.mass.power);
    charts.mass.data.datasets[1].data = sats.map((s) => s.mass.batt);
    charts.mass.data.datasets[2].data = sats.map((s) => s.mass.comp);
    charts.mass.data.datasets[3].data = sats.map((s) => s.mass.rad);
    charts.mass.data.datasets[4].data = sats.map((s) => s.mass.struct);
    charts.mass.update('none');
  }

  // Power budget
  if (charts.powerBudget) {
    const compPct = params.computeFrac * 100;
    const thermalPct = (1 - params.computeFrac) * 0.7 * 100;
    const housePct = 100 - compPct - thermalPct;
    charts.powerBudget.data.datasets[0].data = YEARS.map(() => compPct);
    charts.powerBudget.data.datasets[1].data = YEARS.map(() => thermalPct);
    charts.powerBudget.data.datasets[2].data = YEARS.map(() => housePct);
    charts.powerBudget.update('none');
  }

  // Launch
  if (charts.launch) {
    charts.launch.data.datasets[0].data = YEARS.map((y) => getLaunchCost(y, params));
    charts.launch.update('none');
  }

  // Data rate
  if (charts.dataRate) {
    charts.dataRate.data.datasets[0].data = sats.map((s) => s.dataRateGbps);
    charts.dataRate.update('none');
  }

  // Reliability
  if (charts.reliability) {
    charts.reliability.data.datasets[0].data = YEARS.map((y) => (getShellRadiationEffects('leo', y, params).seuPenalty - 1) * 100);
    charts.reliability.data.datasets[1].data = YEARS.map((y) => (getShellRadiationEffects('meo', y, params).seuPenalty - 1) * 100);
    charts.reliability.data.datasets[2].data = YEARS.map((y) => (getShellRadiationEffects('geo', y, params).seuPenalty - 1) * 100);
    charts.reliability.data.datasets[3].data = YEARS.map((y) => (getShellRadiationEffects('cislunar', y, params).seuPenalty - 1) * 100);
    charts.reliability.update('none');
  }

  // LCOC scenarios
  if (charts.lcocScenarios) {
    charts.lcocScenarios.data.datasets[0].data = sanitizeLcocArray(agg.fleets.map((f) => f.lcocEffective));
    charts.lcocScenarios.data.datasets[1].data = sanitizeLcocArray(base.fleets.map((f) => f.lcocEffective));
    charts.lcocScenarios.data.datasets[2].data = sanitizeLcocArray(cons.fleets.map((f) => f.lcocEffective));
    charts.lcocScenarios.data.datasets[3].data = sanitizeLcocArray(base.gnds.map((g) => g.market));
    charts.lcocScenarios.data.datasets[4].data = sanitizeLcocArray(base.gnds.map((g) => g.base));
    charts.lcocScenarios.update('none');
  }

  // Carbon scenarios
  if (charts.carbonScenarios) {
    charts.carbonScenarios.data.datasets[0].data = agg.sats.map((s) => s.carbonPerTflop);
    charts.carbonScenarios.data.datasets[1].data = base.sats.map((s) => s.carbonPerTflop);
    charts.carbonScenarios.data.datasets[2].data = cons.sats.map((s) => s.carbonPerTflop);
    charts.carbonScenarios.update('none');
  }

  // Efficiency scenarios
  if (charts.effScenarios) {
    charts.effScenarios.data.datasets[0].data = agg.sats.map((s) => s.gflopsW);
    charts.effScenarios.data.datasets[1].data = base.sats.map((s) => s.gflopsW);
    charts.effScenarios.data.datasets[2].data = cons.sats.map((s) => s.gflopsW);
    charts.effScenarios.update('none');
  }
}
