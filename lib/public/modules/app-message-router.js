// Narrow pre-router for Home and Capsule protocol responses kept out of the legacy router.

import { processMessage as processAppMessage } from './app-messages.js';
import { handleHomeMateModelsState, handleHomeMateModelResult } from './home-mate-settings.js';
import { handleHomeMateSessionIdentity, handleHomeDebateTranscript } from './home-mate-chat.js';
import { handleToolLlmConfigState } from './tool-llm-status.js';
import { handleToolSourceState, handleToolMateAccessState } from './home-tools.js';

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
  if (msg.type === "home_debate_proposal") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_debate_proposal_resolved") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_debate_question" || msg.type === "home_debate_question_resolved") {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "home_mate_error" && /^question_/.test(msg.code || "")) {
    handleHomeDebateTranscript(msg);
    return true;
  }
  if (msg.type === "tool_llm_config_state") {
    handleToolLlmConfigState(msg);
    return true;
  }
  if (msg.type === "tool_source_state") {
    handleToolSourceState(msg);
    return true;
  }
  if (msg.type === "tool_mate_access_state") {
    handleToolMateAccessState(msg);
    return true;
  }
  return false;
}

export function processMessage(msg) {
  if (handleHomeProtocolMessage(msg)) return;
  processAppMessage(msg);
}
