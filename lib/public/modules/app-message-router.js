// Narrow pre-router for Home protocol responses kept out of the legacy router.

import { processMessage as processAppMessage } from './app-messages.js';
import { handleHomeMateModelsState, handleHomeMateModelResult } from './home-mate-properties.js';
import { handleHomeMateSessionIdentity } from './home-mate-chat.js';

export function handleHomeProtocolMessage(msg) {
  if (msg.type === "home_mate_models_state") {
    handleHomeMateModelsState(msg);
    return true;
  }
  if (msg.type === "home_mate_model_result") {
    handleHomeMateModelResult(msg);
    return true;
  }
  if (msg.type === "home_mate_session_identity") {
    handleHomeMateSessionIdentity(msg);
    return true;
  }
  return false;
}

export function processMessage(msg) {
  if (handleHomeProtocolMessage(msg)) return;
  processAppMessage(msg);
}
