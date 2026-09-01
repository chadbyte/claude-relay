export function isHomeWorkspaceAssignmentMessage(msg) {
  if (!msg) return false;
  return (msg.type === "home_project_assignment_proposal" || msg.type === "home_project_assignment_status") && !!msg.mateId && !!msg.requestId;
}
