import { store } from './store.js';
import { firstInstalledVendor } from './vendor-priority.js';

export function selectDefaultVendorForBlankSession() {
  var state = store.snap();
  if (!state.activeSessionId || state.sessionHasHistory || state.sessionVendorBound || state.dmMode) return "";
  var vendor = firstInstalledVendor(state.installedVendors);
  if (!vendor) return "";
  if (vendor === state.currentVendor) {
    if (state.vendorSelectionLocked) store.set({ vendorSelectionLocked: false });
    return vendor;
  }
  store.set({
    currentVendor: vendor,
    currentModel: "",
    currentModels: [],
    vendorSelectionLocked: false,
  });
  return vendor;
}
