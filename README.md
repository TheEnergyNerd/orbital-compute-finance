# Orbital Compute Economics Simulator

A physics-first economic model comparing orbital vs. terrestrial data centers using the **Levelized Cost of Compute (LCOC)** framework.

**Author:** Pranav Myana

## What is LCOC?

Everyone measures compute costs wrong. LCOC is the $/GPU-hour over an asset's lifetime, accounting for:
- Capital recovery (amortization)
- Time value of money (WACC)
- Maintenance and operations
- Actual utilization (SLA)

This lets you compare apples to apples: a $10B orbital platform vs. a $500M ground datacenter.

## The Thesis

Space has natural advantages for compute:
- **Free cooling** - radiate to 3K background (no water rights, no chillers)
- **24/7 sun** - no night, no clouds, 1361 W/m²
- **No land costs** - no permitting, no interconnection queues

But faces real constraints:
- Launch costs (falling fast)
- Bandwidth backhaul
- Radiation damage
- Thermal rejection limits

The model calculates when crossover occurs.

## Quick Start

**Option 1: Just open the HTML**
```bash
open index.html
```

**Option 2: Run with dev server**
```bash
npm install
npm run dev
```

## Project Structure

```
├── index.html           # Finance simulator (standalone, all JS inline)
├── whitepaper.html      # Technical whitepaper
├── src/                 # TypeScript source modules
│   ├── model/
│   │   ├── satellite.ts # LCOC calculation - the core
│   │   ├── physics.ts   # Stefan-Boltzmann, launch costs, efficiency
│   │   ├── orbital.ts   # Radiation effects (TID, SEU)
│   │   ├── fleet.ts     # Multi-shell deployment model
│   │   ├── market.ts    # Supply/demand dynamics
│   │   ├── ground.ts    # Terrestrial datacenter costs
│   │   ├── finance.ts   # CRF, WACC calculations
│   │   ├── constants.ts # Physical constants, shell definitions
│   │   └── types.ts     # TypeScript interfaces
│   ├── state/
│   │   ├── params.ts    # Default parameters (50+ sliders)
│   │   └── store.ts     # State management
│   ├── charts/          # Chart.js configuration
│   └── ui/              # Slider and tab handlers
├── tests/
│   └── invariants.test.ts  # Physics sanity checks
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Key Physics

```typescript
// Stefan-Boltzmann: the only equation that matters in space cooling
const radPower = emissivity * STEFAN_BOLTZMANN * Math.pow(opTemp, 4);

// Chip efficiency improves ~20%/year
const gflopsW = 2800 * Math.pow(1 + aiLearn, year - 2026);

// Launch costs follow learning curve
const launchCost = baseCost * Math.pow(1 - launchLearn, year - 2026);
```

## Technology Breakthroughs Modeled

| Technology | Default Year | Impact |
|------------|-------------|--------|
| Droplet Radiators | 2030 | 50× lighter thermal rejection |
| Space Fission | 2035 | 5-20 MW platforms |
| Ground SMRs | 2032 | Cheap nuclear for datacenters |
| Fusion | 2045 (off) | 100+ MW platforms |

## Running Tests

```bash
npm test
```

## License

MIT
