/**
 * WebSocket message type registry.
 *
 * Documents every message type flowing between client and server.
 * Each entry: { direction, handler, description }
 *   direction: "c2s" (client to server), "s2c" (server to client), "both" (bidirectional)
 *   handler: file path where this message type is processed
 *   description: brief description
 *
 * This file is informational. It is not imported at runtime.
 * Use it as a reference when adding new message types.
 */

var schema = {

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------
  "switch_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Switch the active session by local ID" },
  "new_session":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a new blank session" },
  "delete_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Delete a session by ID" },
  "rename_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Rename a session" },
  "set_session_bookmark":     { direction: "c2s", handler: "lib/project-sessions.js", description: "Bookmark or unbookmark a session in the sidebar" },
  "reorder_session_bookmarks": { direction: "c2s", handler: "lib/project-sessions.js", description: "Reorder favorited sessions within the favorites area" },
  "bulk_delete_sessions":    { direction: "c2s", handler: "lib/project-sessions.js", description: "Delete a group of sessions at once" },
  "resume_session":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Resume a CLI session by its CLI session ID" },
  "set_session_visibility":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Show or hide a session in the sidebar" },
  "search_sessions":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Search session titles" },
  "search_session_content":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Full-text search within a session" },
  "list_cli_sessions":        { direction: "c2s", handler: "lib/project-sessions.js", description: "List active CLI sessions available for resume" },
  "load_more_history":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Request older history entries for the current session" },
  "fork_session":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Fork a session from a given message UUID" },
  "input_sync":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Sync the current input field text to other clients" },

  "session_list":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of sessions for the sidebar" },
  "session_switched":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Confirmation that active session changed" },
  "session_id":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "CLI session ID assigned to the current session" },
  "session_presence":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Which users are present in which sessions" },
  "session_io":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Notify that a session has new output activity" },
  "session_unread":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Unread message count for a session" },
  "search_results":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Session title search results" },
  "search_content_results":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full-text content search results" },
  "cli_session_list":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "List of resumable CLI sessions" },
  "fork_complete":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Fork succeeded, includes new session ID" },
  "input_sync_broadcast":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast input text from another client" },

  // -----------------------------------------------------------------------
  // History replay
  // -----------------------------------------------------------------------
  "history_meta":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Metadata about history replay (total count, starting index)" },
  "history_prepend":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Batch of older history entries prepended to timeline" },
  "history_done":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "History replay finished, includes last usage stats" },

  // -----------------------------------------------------------------------
  // Chat / streaming
  // -----------------------------------------------------------------------
  "message":                  { direction: "c2s", handler: "lib/project-user-message.js", description: "Send a user chat message" },
  "user_message":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Echo of the user message in the timeline" },
  "delta":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental text delta from the assistant" },
  "result":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Final assistant result text" },
  "status":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Processing status update (e.g. 'processing')" },
  "done":                     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Query complete, includes exit code" },
  "error":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Error message from server" },
  "info":                     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project info payload sent on connection" },
  "stderr":                   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "stderr output from Claude process" },
  "compacting":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conversation compaction in progress (active: true/false)" },
  "message_uuid":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "UUID assigned to a user or assistant message" },
  "prompt_suggestion":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Suggested follow-up prompt from the assistant" },
  "context_preview":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Preview of context sources included in a query" },

  // -----------------------------------------------------------------------
  // Thinking
  // -----------------------------------------------------------------------
  "thinking_start":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant started a thinking block" },
  "thinking_delta":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental thinking text delta" },
  "thinking_stop":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Thinking block finished, includes duration" },

  // -----------------------------------------------------------------------
  // Tools
  // -----------------------------------------------------------------------
  "tool_start":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant started a tool use block" },
  "tool_executing":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool is executing with parsed input" },
  "tool_result":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool execution result" },
  "slash_command_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Output of a slash command" },

  // -----------------------------------------------------------------------
  // Subagents / tasks
  // -----------------------------------------------------------------------
  "subagent_activity":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Activity indicator for a subagent" },
  "subagent_tool":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Subagent tool use event" },
  "subagent_done":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Subagent task completed" },
  "task_started":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Background task started" },
  "task_progress":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Background task progress update" },

  // -----------------------------------------------------------------------
  // Permissions
  // -----------------------------------------------------------------------
  "permission_request":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Tool permission request from assistant" },
  "permission_request_pending": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request that was pending when client connected" },
  "permission_response":      { direction: "c2s", handler: "lib/project-sessions.js", description: "User response to a permission request" },
  "permission_resolved":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request resolved" },
  "permission_cancel":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Permission request cancelled (e.g. interrupted)" },

  // -----------------------------------------------------------------------
  // Ask user (interactive input)
  // -----------------------------------------------------------------------
  "ask_user":                 { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Assistant is requesting user input via ask_user tool" },
  "ask_user_response":        { direction: "c2s", handler: "lib/project-sessions.js", description: "User reply to an ask_user request" },
  "ask_user_answered":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Confirmation that ask_user was answered" },

  // -----------------------------------------------------------------------
  // Elicitation
  // -----------------------------------------------------------------------
  "elicitation_request":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Structured form elicitation request from assistant" },
  "elicitation_response":     { direction: "c2s", handler: "lib/project-sessions.js", description: "User response to an elicitation form" },
  "elicitation_resolved":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Elicitation request resolved" },

  // -----------------------------------------------------------------------
  // Stop / control
  // -----------------------------------------------------------------------
  "stop":                     { direction: "c2s", handler: "lib/project-sessions.js", description: "Stop the current assistant query" },
  "stop_task":                { direction: "c2s", handler: "lib/project-sessions.js", description: "Stop a specific background task by ID" },
  "kill_process":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Kill a system process by PID" },
  "process_killed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Process was successfully killed" },
  "process_conflict":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conflict: another process is using the session" },

  // -----------------------------------------------------------------------
  // Context / usage
  // -----------------------------------------------------------------------
  "context_usage":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Token usage and context window stats" },
  "context_overflow":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Conversation too long to continue" },

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------
  "auth_required":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Authentication required (e.g. API key needed)" },

  // -----------------------------------------------------------------------
  // Rate limiting / scheduling
  // -----------------------------------------------------------------------
  "rate_limit":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rate limit hit, includes wait time" },
  "rate_limit_usage":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current rate limit usage stats" },
  "schedule_message":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Schedule a message to be sent at a future time" },
  "send_scheduled_now":       { direction: "c2s", handler: "lib/project-user-message.js", description: "Send the scheduled message immediately" },
  "cancel_scheduled_message": { direction: "c2s", handler: "lib/project-user-message.js", description: "Cancel the pending scheduled message" },
  "scheduled_message_queued": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message has been queued" },
  "scheduled_message_sent":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message was sent" },
  "scheduled_message_cancelled": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Scheduled message was cancelled" },
  "auto_continue_scheduled":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue was scheduled after rate limit" },
  "auto_continue_fired":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue timer fired" },

  // -----------------------------------------------------------------------
  // Model / config
  // -----------------------------------------------------------------------
  "set_model":                { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the model for the current session" },
  "set_server_default_model": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default model" },
  "set_project_default_model": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default model" },
  "set_permission_mode":      { direction: "c2s", handler: "lib/project-sessions.js", description: "Set permission mode for the current session" },
  "set_server_default_mode":  { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default permission mode" },
  "set_project_default_mode": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default permission mode" },
  "set_effort":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Set effort level for the current session" },
  "set_server_default_effort": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the server-wide default effort level" },
  "set_project_default_effort": { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the project default effort level" },
  "set_betas":                { direction: "c2s", handler: "lib/project-sessions.js", description: "Set beta feature flags" },
  "set_thinking":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Set thinking mode and budget" },
  "model_info":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current model and available models list" },
  "config_state":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full config state: model, mode, effort, betas, thinking" },
  "slash_commands":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Available slash commands list" },
  "fast_mode_state":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Fast mode toggle state" },
  "client_count":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Number of connected clients" },

  // -----------------------------------------------------------------------
  // Rewind
  // -----------------------------------------------------------------------
  "rewind_preview":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Request a preview of rewinding to a message UUID" },
  "rewind_execute":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Execute the rewind to a message UUID" },
  "rewind_preview_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind preview data and diffs" },
  "rewind_complete":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind executed successfully" },
  "rewind_error":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rewind failed" },

  // -----------------------------------------------------------------------
  // Cursors / presence
  // -----------------------------------------------------------------------
  "cursor_move":              { direction: "both", handler: "lib/project-sessions.js", description: "Cursor position update from a user" },
  "cursor_leave":             { direction: "both", handler: "lib/project-sessions.js", description: "User cursor left the viewport" },
  "text_select":              { direction: "both", handler: "lib/project-sessions.js", description: "Text selection ranges from a user" },

  // -----------------------------------------------------------------------
  // Push notifications
  // -----------------------------------------------------------------------
  "push_subscribe":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Register a push notification subscription" },

  // -----------------------------------------------------------------------
  // Updates
  // -----------------------------------------------------------------------
  "set_update_channel":       { direction: "c2s", handler: "lib/project-sessions.js", description: "Set the update channel (stable/beta)" },
  "check_update":             { direction: "c2s", handler: "lib/project-sessions.js", description: "Check if an update is available" },
  "update_now":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Start the update process" },
  "update_available":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A new version is available" },
  "up_to_date":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Server is already on the latest version" },
  "update_started":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Update download/install has started" },

  // -----------------------------------------------------------------------
  // Process stats
  // -----------------------------------------------------------------------
  "process_stats":            { direction: "both", handler: "lib/project-sessions.js", description: "Request (c2s) or response (s2c) of system process stats" },

  // -----------------------------------------------------------------------
  // Server settings / daemon
  // -----------------------------------------------------------------------
  "get_daemon_config":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Request daemon configuration" },
  "daemon_config":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Daemon configuration payload" },
  "set_pin":                  { direction: "c2s", handler: "lib/project-sessions.js", description: "Set or clear the server access PIN" },
  "set_pin_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "PIN set result" },
  "set_keep_awake":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Enable or disable keep-awake" },
  "set_keep_awake_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Keep-awake setting result" },
  "keep_awake_changed":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: keep-awake state changed" },
  "set_auto_continue":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Enable or disable auto-continue on rate limit" },
  "set_auto_continue_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Auto-continue setting result" },
  "auto_continue_changed":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: auto-continue state changed" },
  "set_image_retention":      { direction: "c2s", handler: "lib/project-sessions.js", description: "Set image retention period in days" },
  "set_image_retention_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Image retention setting result" },
  "shutdown_server":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Request server shutdown" },
  "shutdown_server_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shutdown request result" },
  "restart_server":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Request server restart" },
  "restart_server_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Restart request result" },
  "toast":                    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Ephemeral toast notification" },

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------
  "browse_dir":               { direction: "c2s", handler: "lib/project-sessions.js", description: "Browse directory entries for project creation" },
  "browse_dir_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Directory listing result" },
  "add_project":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Add an existing directory as a project" },
  "add_project_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Add project result" },
  "create_project":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a new empty project directory" },
  "clone_project":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Clone a git repository as a new project" },
  "clone_project_progress":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git clone progress indicator" },
  "create_worktree":          { direction: "c2s", handler: "lib/project-sessions.js", description: "Create a git worktree branch as a new project" },
  "create_worktree_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Worktree creation result" },
  "remove_project_check":     { direction: "c2s", handler: "lib/project-sessions.js", description: "Check how many schedules a project has before removal" },
  "remove_project_check_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Schedule count for project about to be removed" },
  "remove_project":           { direction: "c2s", handler: "lib/project-sessions.js", description: "Remove a project" },
  "remove_project_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Remove project result" },
  "reorder_projects":         { direction: "c2s", handler: "lib/project-sessions.js", description: "Reorder project list by slug array" },
  "reorder_projects_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Reorder result" },
  "set_project_title":        { direction: "c2s", handler: "lib/project-sessions.js", description: "Rename a project" },
  "set_project_title_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Rename project result" },
  "set_project_icon":         { direction: "c2s", handler: "lib/project-sessions.js", description: "Set or clear a project emoji icon" },
  "set_project_icon_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Set icon result" },
  "transfer_project_owner":   { direction: "c2s", handler: "lib/project-sessions.js", description: "Transfer project ownership to another user" },
  "project_owner_changed":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project ownership was transferred" },
  "projects_updated":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: project list changed" },
  "schedule_move":            { direction: "c2s", handler: "lib/project-sessions.js", description: "Move a schedule to a different project" },
  "schedule_move_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Schedule move result" },

  // -----------------------------------------------------------------------
  // Filesystem
  // -----------------------------------------------------------------------
  "fs_list":                  { direction: "c2s", handler: "lib/project-filesystem.js", description: "List directory contents" },
  "fs_list_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Directory listing result" },
  "fs_search":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Search files by name" },
  "fs_search_result":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File search results" },
  "fs_read":                  { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read file contents" },
  "fs_read_result":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File content result" },
  "fs_write":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write file contents" },
  "fs_write_result":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File write result" },
  "fs_delete":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Delete a file" },
  "fs_rename":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Rename a file" },
  "fs_mkdir":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Create a directory" },
  "fs_upload":                { direction: "c2s", handler: "lib/project-filesystem.js", description: "Upload a file" },
  "fs_watch":                 { direction: "c2s", handler: "lib/project-filesystem.js", description: "Start watching a file for changes" },
  "fs_unwatch":               { direction: "c2s", handler: "lib/project-filesystem.js", description: "Stop watching a file" },
  "fs_file_changed":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Watched file content changed" },
  "fs_dir_changed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Watched directory contents changed" },
  "fs_file_history":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Request git history for a file" },
  "fs_file_history_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git file history entries" },
  "fs_git_diff":              { direction: "c2s", handler: "lib/project-filesystem.js", description: "Request a git diff for a commit/file" },
  "fs_git_diff_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Git diff result" },
  "fs_file_at":               { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read a file at a specific git commit hash" },
  "fs_file_at_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File content at a specific commit" },

  // -----------------------------------------------------------------------
  // Project env / CLAUDE.md
  // -----------------------------------------------------------------------
  "get_project_env":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the project .envrc" },
  "project_env_result":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project .envrc content" },
  "set_project_env":          { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the project .envrc" },
  "set_project_env_result":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Project .envrc write result" },
  "read_global_claude_md":    { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the global CLAUDE.md" },
  "global_claude_md_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Global CLAUDE.md content" },
  "write_global_claude_md":   { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the global CLAUDE.md" },
  "write_global_claude_md_result": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Global CLAUDE.md write result" },
  "get_shared_env":           { direction: "c2s", handler: "lib/project-filesystem.js", description: "Read the shared .envrc" },
  "shared_env_result":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shared .envrc content" },
  "set_shared_env":           { direction: "c2s", handler: "lib/project-filesystem.js", description: "Write the shared .envrc" },
  "set_shared_env_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Shared .envrc write result" },

  // -----------------------------------------------------------------------
  // Context sources
  // -----------------------------------------------------------------------
  "context_sources_save":     { direction: "c2s", handler: "lib/project-user-message.js", description: "Save active context source configuration" },
  "context_sources_state":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current active context sources list" },

  // -----------------------------------------------------------------------
  // Terminal
  // -----------------------------------------------------------------------
  "term_create":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Create a new terminal session" },
  "term_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal was created, includes ID" },
  "term_attach":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Attach to a terminal to receive output" },
  "term_detach":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Detach from a terminal" },
  "term_input":               { direction: "c2s", handler: "lib/project-user-message.js", description: "Send input to a terminal" },
  "term_resize":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Resize a terminal" },
  "term_close":               { direction: "c2s", handler: "lib/project-user-message.js", description: "Close a terminal session" },
  "term_rename":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Rename a terminal tab" },
  "term_output":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal output data" },
  "term_resized":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal was resized" },
  "term_exited":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal process exited" },
  "term_closed":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal session was closed" },
  "term_list":                { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of open terminals" },
  "term_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Terminal error (e.g. access denied)" },

  // -----------------------------------------------------------------------
  // Sticky notes
  // -----------------------------------------------------------------------
  "note_create":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Create a new sticky note" },
  "note_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Sticky note was created" },
  "note_update":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Update a sticky note" },
  "note_updated":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Sticky note was updated" },
  "note_delete":              { direction: "c2s", handler: "lib/project-user-message.js", description: "Delete a sticky note" },
  "note_deleted":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Sticky note was deleted" },
  "note_list_request":        { direction: "c2s", handler: "lib/project-user-message.js", description: "Request the full notes list" },
  "note_bring_front":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Bring a note to front (update z-order)" },
  "notes_list":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full list of sticky notes" },

  // -----------------------------------------------------------------------
  // Browser extension
  // -----------------------------------------------------------------------
  "browser_tab_list":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Provide browser tab list from the extension" },
  "extension_result":         { direction: "c2s", handler: "lib/project-user-message.js", description: "Result from a browser extension command" },
  "extension_command":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Command for the browser extension to execute" },
  "clay_ext_tab_list":        { direction: "s2c", handler: "lib/public/modules/app-misc.js", description: "Browser tab list from the extension (broadcast)" },
  "clay_ext_result":          { direction: "s2c", handler: "lib/public/modules/app-misc.js", description: "Browser extension command result (broadcast)" },
  "clay_ext_command":         { direction: "c2s", handler: "lib/public/modules/app-misc.js", description: "Send a command to the browser extension" },

  // -----------------------------------------------------------------------
  // MCP Bridge (remote MCP servers via Chrome Extension)
  // -----------------------------------------------------------------------
  "mcp_servers_available":    { direction: "c2s", handler: "lib/project-mcp.js", description: "Report available MCP servers from Chrome Extension" },
  "mcp_tool_call":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Forward MCP tool call to extension or HTTP endpoint" },
  "mcp_tool_result":          { direction: "c2s", handler: "lib/project-mcp.js", description: "Return MCP tool result from extension" },
  "mcp_tool_error":           { direction: "c2s", handler: "lib/project-mcp.js", description: "Return MCP tool error from extension" },
  "mcp_toggle_server":        { direction: "c2s", handler: "lib/project-mcp.js", description: "Toggle MCP server enabled state for this project" },
  "mcp_servers_state":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast MCP server list and enabled state to clients" },

  // -----------------------------------------------------------------------
  // Skills
  // -----------------------------------------------------------------------
  "skill_installed":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Skill was installed" },
  "skill_uninstalled":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Skill was uninstalled" },

  // -----------------------------------------------------------------------
  // DMs (direct messages)
  // -----------------------------------------------------------------------
  "dm_list":                  { direction: "both", handler: "lib/server-dm.js", description: "Request (c2s) or receive (s2c) DM conversation list" },
  "dm_open":                  { direction: "c2s", handler: "lib/server-dm.js", description: "Open a DM conversation with a user/mate" },
  "dm_history":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "DM conversation history" },
  "dm_send":                  { direction: "c2s", handler: "lib/server-dm.js", description: "Send a DM message" },
  "dm_message":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incoming DM message" },
  "dm_typing":                { direction: "both", handler: "lib/server-dm.js", description: "DM typing indicator" },
  "dm_add_favorite":          { direction: "c2s", handler: "lib/server-dm.js", description: "Add a mate to DM favorites" },
  "dm_remove_favorite":       { direction: "c2s", handler: "lib/server-dm.js", description: "Remove a mate from DM favorites" },
  "dm_favorites_updated":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "DM favorites list updated" },
  "set_mate_dm":              { direction: "c2s", handler: "lib/project-sessions.js", description: "Set active mate for DM mode in a session" },
  "restore_mate_dm":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Restore mate DM mode on reconnect" },

  // -----------------------------------------------------------------------
  // Mates (AI personas)
  // -----------------------------------------------------------------------
  "mate_create":              { direction: "c2s", handler: "lib/server-mates.js", description: "Create a new mate" },
  "mate_created":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was created" },
  "mate_list":                { direction: "both", handler: "lib/server-mates.js", description: "Request (c2s) or receive (s2c) mate list" },
  "mate_delete":              { direction: "c2s", handler: "lib/server-mates.js", description: "Delete a mate" },
  "mate_deleted":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was deleted" },
  "mate_update":              { direction: "c2s", handler: "lib/server-mates.js", description: "Update a mate's properties" },
  "mate_updated":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate was updated" },
  "mate_readd_builtin":       { direction: "c2s", handler: "lib/server-mates.js", description: "Re-add a previously deleted built-in mate" },
  "mate_list_available_builtins": { direction: "c2s", handler: "lib/server-mates.js", description: "List built-in mates available for re-adding" },
  "mate_available_builtins":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Available built-in mates list" },
  "mate_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate operation error" },

  // -----------------------------------------------------------------------
  // Mentions (@mate)
  // -----------------------------------------------------------------------
  "mention":                  { direction: "c2s", handler: "lib/project.js", description: "Mention a mate in the conversation" },
  "mention_stop":             { direction: "c2s", handler: "lib/project.js", description: "Stop a running mention" },
  "mention_processing":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention processing state changed" },
  "mention_start":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention response started" },
  "mention_activity":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention activity indicator" },
  "mention_stream":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental mention response text" },
  "mention_done":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention response complete" },
  "mention_error":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mention processing error" },
  "mention_user":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Echo of user's mention message in timeline" },
  "mention_response":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Full mention response entry in timeline" },

  // -----------------------------------------------------------------------
  // Debate
  // -----------------------------------------------------------------------
  "debate_start":             { direction: "c2s", handler: "lib/project.js", description: "Start a new debate" },
  "debate_hand_raise":        { direction: "c2s", handler: "lib/project.js", description: "Raise hand during a debate" },
  "debate_comment":           { direction: "c2s", handler: "lib/project.js", description: "Submit a comment during a debate" },
  "debate_stop":              { direction: "c2s", handler: "lib/project.js", description: "Stop the current debate" },
  "debate_conclude_response": { direction: "c2s", handler: "lib/project.js", description: "Respond to a debate conclude prompt (end or continue)" },
  "debate_confirm_brief":     { direction: "c2s", handler: "lib/project.js", description: "Confirm the debate brief and start the debate" },
  "debate_proposal_response": { direction: "c2s", handler: "lib/project.js", description: "Respond to a debate proposal" },
  "debate_user_floor_response": { direction: "c2s", handler: "lib/project.js", description: "User submits their statement during user floor turn" },
  "debate_preparing":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate is being prepared" },
  "debate_brief_ready":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate brief is ready for user approval" },
  "debate_started":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate has started" },
  "debate_turn":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A new debate turn is starting" },
  "debate_activity":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate panelist activity indicator" },
  "debate_stream":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Incremental debate response text" },
  "debate_turn_done":         { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate turn completed with full text" },
  "debate_hand_raised":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User hand raise was acknowledged" },
  "debate_comment_queued":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User comment was queued for injection" },
  "debate_comment_injected":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User comment was injected into the debate" },
  "debate_conclude_confirm":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Moderator wants to conclude, asking for confirmation" },
  "debate_user_floor":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User has the floor to speak" },
  "debate_user_floor_done":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User floor turn ended" },
  "debate_user_resume":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "User resumed debate with instruction" },
  "debate_resumed":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate resumed after user floor" },
  "debate_ended":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate has ended" },
  "debate_error":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Debate error" },

  // -----------------------------------------------------------------------
  // Knowledge (mate knowledge files)
  // -----------------------------------------------------------------------
  "knowledge_list":           { direction: "both", handler: "lib/project-knowledge.js", description: "Request (c2s) or receive (s2c) knowledge file list" },
  "knowledge_read":           { direction: "c2s", handler: "lib/project-knowledge.js", description: "Read a knowledge file" },
  "knowledge_content":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file content" },
  "knowledge_save":           { direction: "c2s", handler: "lib/project-knowledge.js", description: "Save a knowledge file" },
  "knowledge_saved":          { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was saved" },
  "knowledge_delete":         { direction: "c2s", handler: "lib/project-knowledge.js", description: "Delete a knowledge file" },
  "knowledge_deleted":        { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was deleted" },
  "knowledge_promote":        { direction: "c2s", handler: "lib/project-knowledge.js", description: "Promote a knowledge file to always-active" },
  "knowledge_promoted":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was promoted" },
  "knowledge_depromote":      { direction: "c2s", handler: "lib/project-knowledge.js", description: "Depromote a knowledge file from always-active" },
  "knowledge_depromoted":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Knowledge file was depromoted" },

  // -----------------------------------------------------------------------
  // Memory (mate memory)
  // -----------------------------------------------------------------------
  "memory_list":              { direction: "both", handler: "lib/project.js", description: "Request (c2s) or receive (s2c) memory entries" },
  "memory_search":            { direction: "c2s", handler: "lib/project.js", description: "Search memory entries" },
  "memory_search_results":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Memory search results" },
  "memory_delete":            { direction: "c2s", handler: "lib/project.js", description: "Delete a memory entry by index" },
  "memory_deleted":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Memory entry was deleted" },

  // -----------------------------------------------------------------------
  // Mate datastore
  // -----------------------------------------------------------------------
  "mate_db_tables":           { direction: "c2s", handler: "lib/project-mate-datastore.js", description: "List schema objects in the current Mate datastore" },
  "mate_db_describe":         { direction: "c2s", handler: "lib/project-mate-datastore.js", description: "Describe a table or view in the current Mate datastore" },
  "mate_db_query":            { direction: "c2s", handler: "lib/project-mate-datastore.js", description: "Run read-only SQL against the current Mate datastore" },
  "mate_db_exec":             { direction: "c2s", handler: "lib/project-mate-datastore.js", description: "Run schema or write SQL against the current Mate datastore" },
  "mate_db_tables_result":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Schema objects returned from a Mate datastore" },
  "mate_db_describe_result":  { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Table description returned from a Mate datastore" },
  "mate_db_query_result":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Query results from a Mate datastore" },
  "mate_db_exec_result":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Execution summary from a Mate datastore" },
  "mate_db_error":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate datastore error" },
  "mate_db_change":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Mate datastore changed" },

  // -----------------------------------------------------------------------
  // Loop (automated task runner)
  // -----------------------------------------------------------------------
  "loop_start":               { direction: "c2s", handler: "lib/project-loop.js", description: "Start the loop runner" },
  "loop_stop":                { direction: "c2s", handler: "lib/project-loop.js", description: "Stop the running loop" },
  "loop_available":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop configuration is available" },
  "loop_started":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop has started running" },
  "loop_iteration":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop iteration progress update" },
  "loop_judging":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop is running the judge step" },
  "loop_verdict":             { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Judge verdict for a loop iteration" },
  "loop_stopping":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop is in the process of stopping" },
  "loop_finished":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop has finished" },
  "loop_error":               { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop error" },
  "loop_scheduled":           { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop was scheduled via cron" },
  "loop_rerun_started":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A loop registry entry re-run has started" },

  // -----------------------------------------------------------------------
  // Loop registry (task schedule management)
  // -----------------------------------------------------------------------
  "loop_registry_list":       { direction: "c2s", handler: "lib/project-loop.js", description: "Request the loop registry list" },
  "loop_registry_update":     { direction: "c2s", handler: "lib/project-loop.js", description: "Update a loop registry entry" },
  "loop_registry_rename":     { direction: "c2s", handler: "lib/project-loop.js", description: "Rename a loop registry entry" },
  "loop_registry_remove":     { direction: "c2s", handler: "lib/project-loop.js", description: "Remove a loop registry entry" },
  "loop_registry_convert":    { direction: "c2s", handler: "lib/project-loop.js", description: "Convert a loop registry entry type" },
  "loop_registry_toggle":     { direction: "c2s", handler: "lib/project-loop.js", description: "Toggle a loop registry entry on/off" },
  "loop_registry_rerun":      { direction: "c2s", handler: "lib/project-loop.js", description: "Re-run a loop registry entry" },
  "loop_registry_files":      { direction: "c2s", handler: "lib/project-loop.js", description: "Request loop registry file contents (PROMPT.md / JUDGE.md)" },
  "loop_registry_files_content": { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop registry file contents" },
  "loop_registry_updated":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Broadcast: loop registry was updated" },
  "loop_registry_error":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop registry operation error" },
  "delete_loop_group":        { direction: "c2s", handler: "lib/project-loop.js", description: "Delete all sessions for a loop group" },

  // -----------------------------------------------------------------------
  // Schedules (hub-level)
  // -----------------------------------------------------------------------
  "schedule_create":          { direction: "c2s", handler: "lib/project-loop.js", description: "Create a new schedule" },
  "hub_schedules_list":       { direction: "c2s", handler: "lib/project-loop.js", description: "Request the hub schedules list" },
  "hub_schedules":            { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Hub schedules list" },
  "schedule_run_started":     { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A scheduled run has started" },
  "schedule_run_finished":    { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "A scheduled run has finished" },

  // -----------------------------------------------------------------------
  // Ralph (loop wizard / crafting)
  // -----------------------------------------------------------------------
  "ralph_wizard_complete":    { direction: "c2s", handler: "lib/project-loop.js", description: "Submit completed wizard data" },
  "ralph_wizard_cancel":      { direction: "c2s", handler: "lib/project-loop.js", description: "Cancel the wizard" },
  "ralph_preview_files":      { direction: "c2s", handler: "lib/project-loop.js", description: "Request preview of loop files" },
  "ralph_cancel_crafting":    { direction: "c2s", handler: "lib/project-loop.js", description: "Cancel file crafting in progress" },
  "ralph_phase":              { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Current ralph wizard phase" },
  "ralph_crafting_started":   { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "File crafting session started" },
  "ralph_files_status":       { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Prompt/judge file readiness status" },
  "ralph_files_content":      { direction: "s2c", handler: "lib/public/modules/app-messages.js", description: "Loop file contents (prompt and judge)" }
};

module.exports = { schema: schema };
