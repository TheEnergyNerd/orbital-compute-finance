import { setParams, getParams } from '../state/store';
import type { Params } from '../model/types';

interface SliderConfig {
  id: string;
  param: keyof Params;
  valueId: string;
  transform?: (val: number) => number;
  format?: (val: number) => string;
}

const sliderConfigs: SliderConfig[] = [
  // Breakthroughs
  { id: 'thermalYear', param: 'thermalYear', valueId: 'v-thermalYear' },

  // Thermal
  {
    id: 'emissivity',
    param: 'emissivity',
    valueId: 'v-emissivity',
    transform: (v) => v / 100
  },
  { id: 'opTemp', param: 'opTemp', valueId: 'v-opTemp' },
  { id: 'radLearn', param: 'radLearn', valueId: 'v-radLearn' },

  // Power
  {
    id: 'solarEff',
    param: 'solarEff',
    valueId: 'v-solarEff',
    transform: (v) => v / 100
  },
  {
    id: 'solarLearn',
    param: 'solarLearn',
    valueId: 'v-solarLearn',
    transform: (v) => v / 1000,
    format: (v) => (v * 1000).toFixed(1)
  },
  { id: 'basePower', param: 'basePower', valueId: 'v-basePower' },
  {
    id: 'computeFrac',
    param: 'computeFrac',
    valueId: 'v-computeFrac',
    transform: (v) => v / 100
  },
  { id: 'battDens', param: 'battDens', valueId: 'v-battDens' },

  // Compute
  {
    id: 'radPen',
    param: 'radPen',
    valueId: 'v-radPen',
    transform: (v) => v / 100
  },
  {
    id: 'aiLearn',
    param: 'aiLearn',
    valueId: 'v-aiLearn',
    transform: (v) => v / 100
  },
  { id: 'satLife', param: 'satLife', valueId: 'v-satLife' },

  // Economics
  { id: 'launchCost', param: 'launchCost', valueId: 'v-launchCost' },
  {
    id: 'launchLearn',
    param: 'launchLearn',
    valueId: 'v-launchLearn',
    transform: (v) => v / 100
  },
  { id: 'launchFloor', param: 'launchFloor', valueId: 'v-launchFloor' },
  {
    id: 'prodMult',
    param: 'prodMult',
    valueId: 'v-prodMult',
    transform: (v) => v / 10
  },
  {
    id: 'maintCost',
    param: 'maintCost',
    valueId: 'v-maintCost',
    transform: (v) => v / 100
  },
  {
    id: 'waccOrbital',
    param: 'waccOrbital',
    valueId: 'v-waccOrbital',
    transform: (v) => v / 100
  },
  {
    id: 'waccGround',
    param: 'waccGround',
    valueId: 'v-waccGround',
    transform: (v) => v / 100
  },

  // Ground
  {
    id: 'groundPue',
    param: 'groundPue',
    valueId: 'v-groundPue',
    transform: (v) => v / 100
  },
  {
    id: 'energyCost',
    param: 'energyCost',
    valueId: 'v-energyCost',
    transform: (v) => v / 1000
  },
  {
    id: 'energyEscal',
    param: 'energyEscal',
    valueId: 'v-energyEscal',
    transform: (v) => v / 100
  },
  { id: 'interconnect', param: 'interconnect', valueId: 'v-interconnect' },

  // Bandwidth
  { id: 'bandwidth', param: 'bandwidth', valueId: 'v-bandwidth' },
  {
    id: 'bwGrowth',
    param: 'bwGrowth',
    valueId: 'v-bwGrowth',
    transform: (v) => v / 100
  },
  {
    id: 'orbitalEligibleShare',
    param: 'orbitalEligibleShare',
    valueId: 'v-orbitalEligibleShare',
    transform: (v) => v / 100
  },

  // Market - demand2025 handled specially below (Exaflops to GW conversion)
  {
    id: 'demandGrowth',
    param: 'demandGrowth',
    valueId: 'v-demandGrowth',
    transform: (v) => v / 100
  },
  // Thermo computing multipliers (logarithmic: 10^x)
  {
    id: 'thermoGroundMult',
    param: 'thermoGroundMult',
    valueId: 'v-thermoGroundMult',
    transform: (v) => Math.pow(10, v),
    format: (v) => Math.round(v).toString()
  },
  {
    id: 'thermoSpaceMult',
    param: 'thermoSpaceMult',
    valueId: 'v-thermoSpaceMult',
    transform: (v) => Math.pow(10, v),
    format: (v) => Math.round(v).toString()
  },
  // Photonic computing multipliers (logarithmic: 10^x)
  {
    id: 'photonicGroundMult',
    param: 'photonicGroundMult',
    valueId: 'v-photonicGroundMult',
    transform: (v) => Math.pow(10, v),
    format: (v) => Math.round(v).toString()
  },
  {
    id: 'photonicSpaceMult',
    param: 'photonicSpaceMult',
    valueId: 'v-photonicSpaceMult',
    transform: (v) => Math.pow(10, v),
    format: (v) => Math.round(v).toString()
  },
  { id: 'supply2025', param: 'supply2025', valueId: 'v-supply2025' },
  {
    id: 'supplyGrowth',
    param: 'supplyGrowth',
    valueId: 'v-supplyGrowth',
    transform: (v) => v / 100
  }
];

export function initSliders(): void {
  const params = getParams();

  sliderConfigs.forEach((config) => {
    const slider = document.getElementById(config.id) as HTMLInputElement | null;
    const valueEl = document.getElementById(config.valueId);

    if (!slider) return;

    slider.addEventListener('input', () => {
      const rawVal = parseFloat(slider.value);
      const val = config.transform ? config.transform(rawVal) : rawVal;

      if (valueEl) {
        const displayVal = config.format
          ? config.format(val)
          : config.transform
            ? (rawVal / (config.transform(1) || 1)).toString()
            : rawVal.toString();
        valueEl.textContent = displayVal;
      }

      setParams({ [config.param]: val } as Partial<Params>);
    });
  });

  // Technology toggles
  const toggleConfigs = [
    { togId: 'tog-fission', yearId: 'year-fission', onParam: 'fissionOn', yearParam: 'fissionYear' },
    { togId: 'tog-fusion', yearId: 'year-fusion', onParam: 'fusionOn', yearParam: 'fusionYear' },
    { togId: 'tog-smr', yearId: 'year-smr', onParam: 'smrOn', yearParam: 'smrYear' },
    { togId: 'tog-thermo', yearId: 'year-thermo', onParam: 'thermoOn', yearParam: 'thermoYear', slidersId: 'thermo-sliders' },
    { togId: 'tog-photonic', yearId: 'year-photonic', onParam: 'photonicOn', yearParam: 'photonicYear', slidersId: 'photonic-sliders' }
  ];

  toggleConfigs.forEach((cfg) => {
    const toggle = document.getElementById(cfg.togId) as HTMLInputElement | null;
    const yearInput = document.getElementById(cfg.yearId) as HTMLInputElement | null;
    const slidersDiv = cfg.slidersId ? document.getElementById(cfg.slidersId) : null;

    if (toggle) {
      toggle.addEventListener('change', () => {
        setParams({ [cfg.onParam]: toggle.checked } as Partial<Params>);
        if (yearInput) {
          yearInput.disabled = !toggle.checked;
        }
        if (slidersDiv) {
          slidersDiv.style.display = toggle.checked ? 'block' : 'none';
        }
      });
    }

    if (yearInput) {
      yearInput.addEventListener('change', () => {
        setParams({ [cfg.yearParam]: parseInt(yearInput.value) } as Partial<Params>);
      });
    }
  });

  // Special handling for demand slider (Exaflops to GW conversion)
  const BASELINE_EFFICIENCY = 3000; // GFLOPS/W standard datacenter

  function formatDemandContext(exaflops: number): string {
    // Convert to baseline GW (fixed reference)
    const baselineGW = (exaflops * 1e12) / (BASELINE_EFFICIENCY * 1e9);
    // Convert to tokens/year (fixed reference)
    const tokensPerYear = exaflops * 1e6 * 0.05 * 8760 * 3600;
    const petatok = tokensPerYear / 1e15;
    return `(≈ ${petatok.toFixed(0)} Petatok/yr | ≈ ${baselineGW.toFixed(0)} GW @ baseline)`;
  }

  const demandSlider = document.getElementById('demand2025') as HTMLInputElement | null;
  const demandVal = document.getElementById('v-demand2025');
  const demandContext = document.getElementById('demand-context');

  if (demandSlider) {
    demandSlider.addEventListener('input', () => {
      const exaflops = parseFloat(demandSlider.value);
      // Convert Exaflops to GW for the model
      const gw = (exaflops * 1000) / BASELINE_EFFICIENCY;
      setParams({ demand2025: gw });
      if (demandVal) demandVal.textContent = exaflops.toString();
      if (demandContext) demandContext.textContent = formatDemandContext(exaflops);
    });
  }
}
