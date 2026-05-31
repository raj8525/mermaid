/* global mermaid */

export const IS_E2E = navigator.webdriver || location.search.includes('graph=');

export function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    deterministicIds: true,
    fontFamily: 'Arial',
    htmlLabels: false,
    themeVariables: {
      background: '#fffaf0',
      mainBkg: '#fff7ed',
      primaryColor: '#f8ead1',
      primaryTextColor: '#111827',
      secondaryColor: '#e0f2fe',
      tertiaryColor: '#ede9fe',
      textColor: '#111827',
      lineColor: '#475569',
      actorBkg: '#fff7ed',
      actorBorder: '#64748b',
      actorTextColor: '#111827',
      noteBkgColor: '#fef3c7',
      noteTextColor: '#111827',
      signalColor: '#334155',
      signalTextColor: '#111827',
      labelTextColor: '#111827',
    },
    flowchart: {
      useMaxWidth: false,
    },
  });
}

export let state = {
  scale: 1,
  panX: 0,
  panY: 0,
  iframeRef: null,
  svgRef: null,
};
