export function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  const panels = document.querySelectorAll<HTMLElement>('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (!target) return;

      // Update tab buttons
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panels
      panels.forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.tab === target);
      });
    });
  });
}
