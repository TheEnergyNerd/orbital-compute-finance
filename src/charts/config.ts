import type { ChartOptions } from 'chart.js';

// Chart.js global defaults
export function setChartDefaults(): void {
  // These will be set after Chart import
}

export function getLineOptions(yLabel: string, log = false): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        type: log ? 'logarithmic' : 'linear',
        title: { display: true, text: yLabel }
      }
    }
  };
}

export function getStackedOptions(yLabel: string): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { stacked: true },
      y: { stacked: true, title: { display: true, text: yLabel } }
    }
  };
}

// Colors
export const COLORS = {
  orbital: '#1a8a6a',
  orbitalFill: 'rgba(26,138,106,0.2)',
  orbitalArea: 'rgba(26,138,106,0.5)',
  ground: '#c44a3a',
  groundFill: 'rgba(196,74,58,0.1)',
  accent: '#3a7ab8',
  accentFill: 'rgba(58,122,184,0.5)',
  warning: '#d49a22',
  warningFill: 'rgba(212,154,34,0.5)',
  purple: '#7a4ba8',
  purpleFill: 'rgba(122,75,168,0.5)',
  orange: '#d4622a',
  orangeFill: 'rgba(212,98,42,0.7)',
  muted: '#7a7a88',
  transparent: 'transparent'
};
