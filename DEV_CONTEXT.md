# Orbital Compute - Dev Context

## Project Overview

A physics-first orbital compute economics simulator with two themes:
- **Main** (landing): Warm aesthetic with 3D world visualization
- **Finance** (`/finance`): Professional Bloomberg-style simulator

**Author**: Pranav Myana
**Goal**: Deploy to Vercel, open-source on GitHub

---

## Current File Structure

```
orbital-compute/
├── public/
│   ├── index.html                      # MAIN SIMULATOR (tabs: World, Core, Market, etc.)
│   ├── orbital-visualization-example.html  # 3D Earth visualization (Three.js)
│   ├── simple-orbit-controls.js        # Camera controls for 3D
│   ├── finance/
│   │   ├── index.html                  # FINANCE SIMULATOR
│   │   └── whitepaper.html             # Whitepaper with KaTeX formulas + chart
│   └── assets/
│       └── whitepaper.pdf
├── src/                                # Source modules (for GitHub credibility)
│   ├── model/
│   │   ├── constants.js
│   │   ├── physics.js
│   │   ├── market.js
│   │   └── finance.js
│   └── state/
│       └── params.js
├── tests/
│   └── invariants.js
├── package.json
├── vite.config.js
└── README.md
```

---

## Issues to Fix

### 1. iframe 404 in World Tab
**File**: `public/index.html` line ~266
**Problem**: Opening file:// directly causes CORS error loading the iframe
**Solution**: Must run with server (`npm run dev`). This is expected - just document it.

### 2. Core Charts Should Appear Below World Tab When Scrolling
**File**: `public/index.html`
**Current**: World tab only has iframe, no charts visible
**Wanted**: When user scrolls down in World tab, they see LCOC and Fleet charts

**Location in code** (around line 264):
```html
<!-- WORLD TAB -->
<div class="tab-panel active" data-tab="world">
  <div class="world-container">
    <iframe id="world-iframe" src="orbital-visualization-example.html" ...></iframe>
  </div>
  <!-- ADD CHARTS HERE -->
</div>
```

### 3. Core Charts Should Appear Below Sandbox Tab When Scrolling
**File**: `public/index.html`
**Current**: Sandbox tab has sliders only
**Wanted**: Charts below the sliders

**Location in code** (around line 815):
```html
<!-- SANDBOX TAB -->
<div class="tab-panel" data-tab="sandbox">
  <div class="sandbox-grid">
    <!-- all the sliders -->
  </div>
  <!-- ADD CHARTS HERE -->
</div>
```

### 4. Chart Canvas ID Conflict
**Problem**: Chart.js binds to canvas IDs. If we add charts to World and Sandbox tabs, they need unique IDs.

**Options**:
A) Duplicate canvases with different IDs (`c-lcoc-world`, `c-lcoc-sandbox`, `c-lcoc-core`)
B) Move canvases between tabs on tab switch
C) Destroy and recreate charts on tab switch

**Recommendation**: Option A is simplest - duplicate the LCOC and Fleet charts for World and Sandbox tabs.

---

## Key Code Sections in public/index.html

### Tab Structure (line ~241)
```html
<div class="tabs">
  <button class="tab active" data-tab="world">World</button>
  <button class="tab" data-tab="core">Core</button>
  <button class="tab" data-tab="market">Market</button>
  <button class="tab" data-tab="constraints">Constraints</button>
  <button class="tab" data-tab="physics">Physics</button>
  <button class="tab" data-tab="futures">Futures</button>
  <button class="tab" data-tab="sandbox">Sandbox</button>
</div>
```

### World Tab (line ~264)
```html
<div class="tab-panel active" data-tab="world">
  <div class="world-container">
    <iframe id="world-iframe" src="orbital-visualization-example.html" 
            style="width: 100%; height: calc(100vh - 120px); border: none;"></iframe>
  </div>
</div>
```

### Core Tab Charts (line ~282) - REFERENCE FOR DUPLICATION
```html
<div class="charts">
  <div class="chart-card wide tall">
    <div class="chart-header">
      <div class="chart-title">LCOC with Uncertainty ($/GPU-hr)</div>
    </div>
    <div class="chart-box"><canvas id="c-lcoc"></canvas></div>
    <div class="legend">...</div>
  </div>
  <!-- More charts... -->
</div>
```

### Sandbox Tab (line ~815)
```html
<div class="tab-panel" data-tab="sandbox">
  <div class="sandbox-grid">
    <!-- Breakthroughs section -->
    <!-- Thermal section -->
    <!-- Power section -->
    <!-- etc... -->
  </div>
</div>
```

### Chart Initialization (line ~1800+)
Charts are created in the `initCharts()` function and updated in `update()`.

Key charts to duplicate:
- `c-lcoc` - LCOC comparison (most important)
- `c-fleet` - Fleet power stacked area

### Update Function (line ~1500+)
```javascript
function update() {
  const base = runScenario('baseline');
  // ... updates all KPIs and charts
}
```

---

## Implementation Plan

### Step 1: Add Summary Charts to World Tab
After the iframe, add a summary section:

```html
<div class="tab-panel active" data-tab="world">
  <div class="world-container">
    <iframe ...></iframe>
  </div>
  
  <div class="world-summary" style="padding: 16px;">
    <div class="kpis">
      <!-- Copy KPIs from Core tab, use same IDs (they update together) -->
    </div>
    <div class="charts" style="margin-top: 16px;">
      <div class="chart-card wide tall">
        <div class="chart-header">
          <div class="chart-title">LCOC Crossover ($/GPU-hr)</div>
        </div>
        <div class="chart-box"><canvas id="c-lcoc-world"></canvas></div>
      </div>
    </div>
  </div>
</div>
```

### Step 2: Add Charts to Sandbox Tab
After sandbox-grid:

```html
<div class="tab-panel" data-tab="sandbox">
  <div class="sandbox-grid">...</div>
  
  <div class="sandbox-summary" style="padding: 16px;">
    <div class="charts">
      <div class="chart-card wide tall">
        <div class="chart-box"><canvas id="c-lcoc-sandbox"></canvas></div>
      </div>
    </div>
  </div>
</div>
```

### Step 3: Initialize Additional Charts
In `initCharts()`, add:

```javascript
// World tab chart
charts['lcoc-world'] = new Chart(document.getElementById('c-lcoc-world'), {
  // Same config as c-lcoc
});

// Sandbox tab chart  
charts['lcoc-sandbox'] = new Chart(document.getElementById('c-lcoc-sandbox'), {
  // Same config as c-lcoc
});
```

### Step 4: Update Additional Charts
In `update()`, update the new charts with same data:

```javascript
// Update world tab chart
if (charts['lcoc-world']) {
  charts['lcoc-world'].data.datasets[0].data = orbitalData;
  charts['lcoc-world'].data.datasets[1].data = groundData;
  charts['lcoc-world'].update('none');
}
// Same for sandbox
```

---

## CSS Notes

Key classes:
- `.world-container` - Full height container for iframe
- `.sandbox-grid` - CSS grid for slider sections
- `.chart-card` - Chart container with border/shadow
- `.chart-card.wide` - Full width chart
- `.chart-card.tall` - Taller chart box

---

## Testing

After changes:
1. `npm run dev`
2. Check World tab - iframe loads, scroll down to see charts
3. Check Sandbox tab - sliders work, scroll down to see charts
4. Check Core tab - original charts still work
5. Adjust a slider - ALL charts should update

---

## Key Files to Understand

1. **public/index.html** - Main simulator (THE BIG ONE, ~2000 lines)
2. **public/finance/index.html** - Finance simulator
3. **public/finance/whitepaper.html** - Whitepaper with formulas
4. **public/orbital-visualization-example.html** - 3D visualization
5. **public/simple-orbit-controls.js** - Camera controls
6. **package.json** - Dependencies
7. **vite.config.js** - Build config

The `src/` files are for GitHub show - the actual logic is in the HTML files.

---

## Quick Commands

```bash
# Install
npm install

# Dev server (fixes iframe issue)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run invariant tests
npm test
```

---

## Routes When Deployed

| URL | File |
|-----|------|
| `/` | `public/index.html` (main + world) |
| `/finance` | `public/finance/index.html` |
| `/finance/whitepaper.html` | `public/finance/whitepaper.html` |

---

## LCOC Formulas (verified correct)

```
DeliveredGPUh = GPUeq × 8760 × SLA × min(1, BWavail/BWneed) × min(1, D/C)

LCOCeffective = LCOCbase / uSell

LCOCbase = (CAPEX × CRF + OPEX) / (GPUeq × 8760 × SLA)

CRF = r(1+r)^n / ((1+r)^n - 1)
```

Where:
- SLA = 0.999 (99.9% uptime)
- r = WACC (12% orbital, 8% ground)
- n = asset lifetime (8 years default)
