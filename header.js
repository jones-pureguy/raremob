/**
 * Global Header Component
 * Renders gold + chip currency bar into #global-header
 */
function initHeader(options = {}) {
  const showChip = options.showChip !== false;
  const container = document.getElementById('global-header');
  if (!container) return;

  const chipHtml = showChip ? `
    <div class="currency-item">
      <img src="./images/chip.png" alt="chip" class="currency-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline'"><span style="display:none; font-size:1rem;">🎰</span>
      <span class="currency-value" id="chipDisplay">0</span>
    </div>` : '';

  container.innerHTML = `
    <div class="currency-bar">
      <div class="currency-item">
        <img src="./images/coin.png" alt="gold" class="currency-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline'"><span style="display:none; font-size:1rem;">💰</span>
        <span class="currency-value" id="goldDisplay">0</span>
      </div>
      ${chipHtml}
    </div>`;

  _updateHeaderValues(showChip);

  window.addEventListener('goldUpdated', () => _updateHeaderValues(showChip));
  window.addEventListener('chipUpdated', () => _updateHeaderValues(showChip));
}

function _updateHeaderValues(showChip) {
  const gold = parseInt(localStorage.getItem('poker_gold') || '0');
  const goldEl = document.getElementById('goldDisplay');
  if (goldEl) goldEl.textContent = gold.toLocaleString();

  if (showChip) {
    const chip = parseInt(localStorage.getItem('userChip') || '0');
    const chipEl = document.getElementById('chipDisplay');
    if (chipEl) chipEl.textContent = chip.toLocaleString();
  }
}
