import { store } from './store.js';
import { requestTools } from './home-tools.js';
import { closeHomeDock } from './home-dock.js';
import { showToast } from './utils.js';

function applyCapsulesEnabled(enabled, refreshTools) {
  var want = enabled === true;
  store.set({ capsulesEnabled: want, capsulesPreferenceLoaded: true });
  if (document.body) document.body.classList.toggle('capsules-disabled', !want);
  if (!want && store.get('dockOpen') === true) closeHomeDock();
  if (refreshTools !== false) requestTools();
}

export function initCapsulePreference() {
  var toggle = document.getElementById('us-capsules-enabled');
  if (!toggle) return;
  toggle.addEventListener('change', function () {
    var previous = store.get('capsulesEnabled') === true;
    var want = this.checked === true;
    applyCapsulesEnabled(want, false);
    fetch('/api/user/capsules-enabled', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: want }),
    }).then(function (response) {
      if (!response.ok) throw new Error('Could not save the Capsules preference.');
      return response.json();
    }).then(function (data) {
      applyCapsulesEnabled(data.capsulesEnabled === true, true);
      showToast(data.capsulesEnabled ? 'Experimental Capsules enabled' : 'Experimental Capsules disabled');
    }).catch(function () {
      toggle.checked = previous;
      applyCapsulesEnabled(previous, true);
      showToast('Could not save the Capsules preference.', 'error');
    });
  });
}

export function syncCapsulePreference(enabled) {
  var want = enabled === true;
  var toggle = document.getElementById('us-capsules-enabled');
  if (toggle) toggle.checked = want;
  applyCapsulesEnabled(want, true);
}
