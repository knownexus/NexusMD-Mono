'use strict';

const tabsEl = document.getElementById('tabs');

function render(tabs) {
  tabsEl.innerHTML = '';
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.active ? ' active' : '');
    el.title = tab.url;
    el.onclick = () => window.linkWindowAPI.switchTab(tab.id);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || tab.url;
    el.appendChild(title);

    const refresh = document.createElement('button');
    refresh.className = 'tab-refresh';
    refresh.title = 'Refresh';
    refresh.textContent = '⟳';
    refresh.onclick = (e) => {
      e.stopPropagation();
      window.linkWindowAPI.refreshTab(tab.id);
    };
    el.appendChild(refresh);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.onclick = (e) => {
      e.stopPropagation();
      window.linkWindowAPI.closeTab(tab.id);
    };
    el.appendChild(close);

    tabsEl.appendChild(el);
  }
}

window.linkWindowAPI.onTabsUpdated(render);
