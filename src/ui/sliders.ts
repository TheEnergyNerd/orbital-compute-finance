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
  { id: 'dropletYear', param: 'dropletYear', valueId: 'v-dropletYear' },

  // Thermal
  {
    id: 'emissivity',
    param: 'emissivity',
    valueId: 'v-emissivity',
    transform: (v) => v / 100
  },
  { id: 'opTemp', param: 'opTemp', valueId: 'v-opTemp' },

  // Power
  {
    id: 'solarEff',
    param: 'solarEff',
    valueId: 'v-solarEff',
    transform: (v) => v / 100
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

  // Market
  { id: 'demand2025', param: 'demand2025', valueId: 'v-demand2025' },
  {
    id: 'demandGrowth',
    param: 'demandGrowth',
    valueId: 'v-demandGrowth',
    transform: (v) => v / 100
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
    { togId: 'tog-smr', yearId: 'year-smr', onParam: 'smrOn', yearParam: 'smrYear' }
  ];

  toggleConfigs.forEach((cfg) => {
    const toggle = document.getElementById(cfg.togId) as HTMLInputElement | null;
    const yearInput = document.getElementById(cfg.yearId) as HTMLInputElement | null;

    if (toggle) {
      toggle.addEventListener('change', () => {
        setParams({ [cfg.onParam]: toggle.checked } as Partial<Params>);
        if (yearInput) {
          yearInput.disabled = !toggle.checked;
        }
      });
    }

    if (yearInput) {
      yearInput.addEventListener('change', () => {
        setParams({ [cfg.yearParam]: parseInt(yearInput.value) } as Partial<Params>);
      });
    }
  });
}
