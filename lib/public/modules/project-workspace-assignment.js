import { addToMessages, scrollToBottom } from './app-rendering.js';
import { createWorkspaceAssignmentCard, showWorkspaceAssignmentError } from './workspace-assignment-card.js';

function findCard(assignmentId) {
  var cards = document.querySelectorAll(".workspace-assignment-card:not(.home-workspace-assignment)");
  for (var i = 0; i < cards.length; i++) if (cards[i].dataset.assignmentId === assignmentId) return cards[i];
  return null;
}

export function renderProjectWorkspaceAssignment(msg) {
  var assignment = msg && msg.assignment;
  if (!assignment || !assignment.assignmentId) return false;
  var previous = findCard(assignment.assignmentId);
  var card = createWorkspaceAssignmentCard(assignment, { home: false });
  if (previous && previous.parentNode) previous.parentNode.replaceChild(card, previous);
  else addToMessages(card);
  scrollToBottom();
  return true;
}

export function showProjectWorkspaceAssignmentError(msg) {
  return showWorkspaceAssignmentError(findCard(msg && msg.assignmentId), msg || {});
}
