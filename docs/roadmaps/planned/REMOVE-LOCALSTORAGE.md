# Remove localStorage Usage

> Migrate all client-side localStorage usage to server-side storage. Settings must persist across devices and browsers.

**Created**: 2026-04-17
**Status**: Planning

---

## Problem

Multiple UI settings are stored in `localStorage`, which means they are browser-specific and do not sync across devices. Project rule requires all settings to be server-side.

## Current localStorage Usage

| Key | Purpose | Migration target |
|-----|---------|-----------------|
| `sidebar-collapsed` | Desktop sidebar collapse state | User preferences (per-user) |
| `sidebar-width` | Sidebar panel width | User preferences (per-user) |
| `clay-theme-vars`, `clay-theme-variant` | Theme selection and CSS vars | User preferences (already partially server-synced) |
| `notif-alert`, `notif-sound`, `notif-push` | Notification preferences | User preferences |
| `clay-active-dm` | Last active DM user | User preferences |
| `clay-project-hint-dismissed` | First-time project hint | User preferences |
| `clay-project-name-*`, `clay-project-icon-*` | Cached project metadata | Remove (already fetched from server) |
| `clay_my_user` | Cached user profile | Remove (already fetched from server) |
| `clay-playbooks-done` | Completed playbook tracking | User preferences |
| `push-endpoint`, `vapid-key`, `setup-done` | Push notification state | Keep (browser-specific, not a setting) |
| `onboarding-dismissed` | Onboarding state | User preferences |

## Approach

1. Add a `uiPreferences` object to user data (per-user in `users.json`)
2. Create WebSocket message pair: `ui_preferences_get` / `ui_preferences_save`
3. Client loads preferences on connect, saves on change
4. Remove localStorage calls one by one, replacing with server round-trip
5. Push notification keys (`push-endpoint`, `vapid-key`) stay in localStorage (they are browser-specific by nature)

## Implementation Order

1. Add server-side `uiPreferences` storage
2. Migrate sidebar settings (collapsed, width)
3. Migrate notification preferences
4. Migrate theme settings
5. Remove cached data keys (project name/icon, user profile)
6. Clean up remaining keys
