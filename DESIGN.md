# Clay Design System

Version 1.0 | Last updated: 2026-03-23

---

## 1. Philosophy

### Clay is a space, not a tool

Tools are used and closed. Spaces are inhabited.

Just as Slack became "where teams work" rather than "a chat tool," Clay is "where you work with AI" rather than "an AI tool." When users enter Clay, the first impression should be: warm, organized, and my place.

This philosophy is the starting point for every design decision. When adding or changing any element, ask: "Does this make the space better?"

### Three design promises

**1. Quiet Order**
A good space has invisible rules, yet you instinctively know where everything is. You walk into a cafe and know where to order without anyone telling you. Every element follows a predictable system, but that system should never feel conscious.

**2. Warm Density**
Dense information that never feels cramped. Not the cold density of a developer tool, but the warm density of a well-organized desk. Conserve space, but leave room to breathe.

**3. Presence**
AI is not an API response. It is a teammate who is "there." Avatars, names, status indicators. These elements make AI feel like "being with" rather than "using."

---

## 2. Brand Identity

### 2.1 Logo

Rainbow gradient (mint > blue > purple > pink > orange > yellow) applied to "Clay" text. The rainbow is finalized. The typeface is not yet finalized (currently rounded typeface + bold outline, subject to change).

**Logo origin:** Derived from the CLI tri-accent gradient. Three color stops interpolated across 9 lines and refined into 6 color bands.

**CLI source stops (3 colors):**

| Stop | Color | HEX |
|------|-------|-----|
| Top | Green | `#09E5A3` |
| Mid | Indigo | `#5857FC` |
| Bottom | Terracotta | `#FE7150` |

**Logo band colors (6 colors):**

| # | Name | HEX | Position |
|---|------|-----|----------|
| 1 | Vivid Green | `#00EBA0` | Top |
| 2 | Vivid Teal | `#00C8DC` | |
| 3 | Vivid Blue | `#1E64FF` | |
| 4 | Vivid Indigo | `#5832FF` | |
| 5 | Vivid Magenta | `#C83CB4` | |
| 6 | Vivid Terracotta | `#FF5A32` | Bottom |

Higher saturation than CLI source for vivid, clean rendering.

### 2.2 Logo construction

```
+-----------------------------------+
|         White Stroke              |  <- outermost, separates from background
|  +-----------------------------+  |
|  |      Black Stroke           |  |  <- letter outline emphasis
|  |  +------------------------+ |  |
|  |  |   Gradient/Band Fill   | |  |  <- 6-color fill (top to bottom)
|  |  +------------------------+ |  |
|  +-----------------------------+  |
+-----------------------------------+
```

- White stroke : Black stroke ratio ~ 2:1
- Total stroke thickness ~ 15-20% of letter stroke width

### 2.3 Logo variants

**Wordmark (full "Clay" text):**

| Variant | Description | File |
|---------|-------------|------|
| Banded | 6-color bands, hard edges | `clay-wordmark-banded.png` |
| Gradient | Smooth color transitions | `clay-wordmark-gradient.png` |

**Icon (standalone "C"):**

| Variant | Files |
|---------|-------|
| Banded | `icon-banded-{128,256,512,1024}.png` |
| Gradient | `icon-gradient-{128,256,512,1024}.png` |
| Transparent | `icon-{banded,gradient}-{256,512,1024}-transparent.png` |

**Favicon:**

| File | Size | Use |
|------|------|-----|
| `favicon-banded.png` | 16x16 | Browser tab |
| `favicon-32.png` | 32x32 | High-DPI tab |
| `favicon-48.png` | 48x48 | Bookmarks |
| `favicon.ico` | multi | Legacy |

### 2.4 Logo usage rules

1. **Primary**: Banded variant. Official logo, UI top bar, favicon.
2. **Secondary**: Gradient variant. Marketing, presentations.
3. **Minimum size**: Icon 16px, wordmark height no smaller than 14px.
4. **Background**: White or light gray recommended. Use transparent variant on dark backgrounds.
5. **No modifications**: No reordering colors, rotating, adding shadows, or removing strokes.
6. **Clear space**: Maintain at least 50% of the "C" height as padding around the logo.
7. **Color order is fixed**: Green, Teal, Blue, Indigo, Magenta, Terracotta. Never reorder.
8. **Three-layer structure is mandatory**: fill, black stroke, white stroke. Never omit a layer.

### 2.5 Favicon animation

Color flow animation on favicon for urgent states:

- **Method**: 6-color bands flow top-to-bottom (canvas-based)
- **Speed**: ~12fps (83ms intervals)
- **Use**: Permission requests, user input needed, urgent states only
- **Restore**: Immediately revert to static favicon when state clears

### 2.6 Brand tone

Earthy warmth + playful vibrancy. A balance between the logo's colorfulness and the UI's restraint.

**Clay's color DNA**: Backgrounds use warm beige/brown tones. Avoid cold blue-grays. Just as Slack's aubergine is unmistakably Slack, Clay's warm beige is unmistakably Clay.

When in doubt about a color choice, place it next to the logo.

---

## 3. Color System

### 3.1 Design intent

Clay's color is "warmth." Pure black (#000) and pure white (#fff) are never used. Every color carries a subtle warm undertone (reddish/earthy), making the interface comfortable for extended use and never mechanical.

### 3.2 Theme architecture

Clay defines themes using the base16 color scheme (base00-base0F + accent2). `theme.js` maps these values to CSS variables.

```
base00 -> --bg            Main background
base01 -> --bg-alt        Raised surface
base02 -> --border        Border
base03 -> --text-dimmer   Dimmest text
base04 -> --text-muted    Muted text
base05 -> --text          Primary text
base09 -> --accent        Primary accent
accent2 -> --accent2      Secondary accent
```

Derived values (sidebar-bg, input-bg, etc.) are auto-calculated from base values by theme.js. They are not defined directly in theme files.

### 3.3 Clay official theme colors

**Clay Light (finalized, default theme)**

```
Background:       #F3EBE7   Warm beige. Clay's signature.
Surface:          #EBE1DC   Slightly darker beige.
Border:           #D8CCC6   Soft tonal boundary.
Primary text:     #504541   Warm dark brown. Not pure black.
Secondary text:   #786D67
Muted text:       #A09590
Primary accent:   #F74728   Vivid orange-red. Energy and action.
Secondary accent: #2A26E5   Deep blue. Information and links.
```

**Clay Dark (direction only, not finalized)**

```
Background:       #1F1B1B   Warm near-black. Not pure black.
Surface:          #2A2525   Warm dark brown.
Border:           #352F2F
Primary text:     #C2BAB4   Warm light beige.
Primary accent:   #FE7150   Brighter orange for dark background visibility.
Secondary accent: #5857FC   Brighter blue for dark background visibility.
```

Rules:
- Light mode is default. Dark mode is secondary.
- Clay Light/Dark's warm undertone is the color DNA. Recommended for custom themes too.
- The 24 bundled themes (Dracula, Nord, etc.) use their own color schemes. Clay's palette is not forced on them.
- The hardcoded defaults in base.css are Dracula (fallback only). Clay's identity lives in the Clay Light/Dark theme files.

### 3.4 Accent palette

Three accent groups, each with three brightness levels:

| Group | Bright | Mid | Deep |
|-------|--------|-----|------|
| Green | `#09E5A3` | `#00B785` | `#066852` |
| Blue  | `#5857FC` | `#2A26E5` | `#1C1979` |
| Red   | `#FE7150` | `#F74728` | `#BA2E19` |

Light theme uses Mid-Deep levels. Dark theme uses Bright-Mid levels.

### 3.5 Body palette

Clay/rose tones. The basis for Light theme's base00-02:

| Light | Mid | Deep |
|-------|-----|------|
| `#DAC7C4` | `#D6B6B0` | `#C0A9A4` |

### 3.6 Base16 slot mapping

| Slot | Role | Light | Dark |
|------|------|-------|------|
| base00-02 | Background tones | Clay/rose body | Warm brown body |
| base03-05 | Text hierarchy | Warm grays | Warm grays, brighter |
| base08 | Error / destructive | Deep red | Mid red |
| base09 | **Primary accent** | Mid red | Bright red |
| base0A | Warning / yellow | Warm gold | Warm gold, saturated |
| base0B | Success / green | Deep green | Bright green |
| base0C | Info / teal | Deep teal | Teal |
| base0D | Links / blue | Rich blue | Bright blue |
| base0E | Special / purple | Muted purple | Saturated purple |
| base0F | Misc / brown | Clay brown | Clay brown |
| accent2 | **Secondary accent** | Mid blue | Bright blue |

### 3.7 Accent system

**`--accent` (base09, terracotta):** Primary interaction color. Buttons, link hover, progress bars, focus rings.

**`--accent2` (indigo):** Information/status display color. Activity text, user island avatar, AskUserQuestion highlight, tool link hover, file history badge, session info copy button.

Thinking blocks do NOT use accent2 (they use overlay-rgb based styling).

### 3.8 Background layers

4 levels. All depth is expressed with these 4. If a 5th is needed, rethink the design.

```
Level 0  --bg-base      Deepest floor. Main content area.
Level 1  --bg-raised    One step up. Sidebar, cards, headers.
Level 2  --bg-overlay   Floating surface. Modals, dropdowns, popovers, toasts.
Level 3  --bg-input     Inside input fields. Where users type.
```

Rules:
- Level 0 below Level 1 below Level 2. Never invert.
- Same-level surfaces overlap? Separate with borders. Do not invent a new background color.
- Level 2 (overlay) must always have a shadow. No shadowless floating elements.

### 3.9 Text hierarchy

4 levels.

```
--text-primary      Primary text. Body, headings, must-read content.
--text-secondary    Secondary text. Descriptions, subtitles, metadata.
--text-muted        Muted text. Timestamps, hints, placeholders.
--text-disabled     Disabled text. Non-interactive elements only.
```

Rules:
- If --text-primary exceeds 60% of all text on screen, the hierarchy has collapsed. Re-classify information.
- --text-disabled is only for non-interactive elements. "Less important" text uses --text-muted.

### 3.10 Semantic colors

4 colors. No additions.

```
--color-accent     Primary action, brand, emphasis.
--color-success    Complete, connected, active.
--color-error      Error, danger, deletion.
--color-warning    Caution, pending, in progress.
```

Each has 3 background variants:

```
Base         --color-accent                Foreground: text, icons, borders.
Subtle       --color-accent-subtle   8%   Background tint. Selection state, badge bg.
Muted        --color-accent-muted    15%  Hover state background.
Strong       --color-accent-strong   25%  Active state, toggle ON background.
```

Same 3 variants for all 4 colors. Total: 4 x 4 = 16 color variables.

Rules:
- No hardcoded colors (#6c5ce7, #0ACF83, etc.). All colors through variables.
- Semantic colors are not decorative. Green means "success," not "pretty."
- Never use semantic colors directly as backgrounds. Use subtle/muted/strong variants. Base values are for foreground only.

### 3.11 Borders

```
--border-default    Standard separator. Between regions.
--border-subtle     Light separator. Between items within a region.
```

Rules:
- Prefer background color difference over borders. Borders are a fallback.
- Border width is always 1px. 2px+ borders are decoration.
- Exception: Active tab left indicator (3px solid --color-accent). This is an indicator, not a border.

### 3.12 Selection

Text drag selection: `rgba(9, 229, 163, 0.25)`. Fixed green. The only hardcoded color, independent of theme.

### 3.13 Mate colors

Each Mate may have a system-assigned unique color tone used for avatar backgrounds and subtle message area tinting.

Rules:
- Mate colors do not affect structural UI elements (buttons, borders, background layers).
- Mate colors are always low saturation. A neon Mate must not dominate the screen.

---

## 4. Typography

### 4.1 Design intent

Clay is a conversation-first interface. Text covers 80%+ of every screen. Typography IS the interface. Font size, weight, and line-height choices matter more than layout.

### 4.2 Font stacks

```
Body:   "Pretendard", system-ui, -apple-system, sans-serif
Code:   "Roboto Mono", ui-monospace, monospace
Emoji:  "Twemoji Mozilla", "Apple Color Emoji", sans-serif
Logo:   "Nunito Black" (logo only)
```

No additional fonts. Pretendard loads weights 100-900, but only 3 are used (see 4.4).

### 4.3 Size scale

5 steps. Only these 5 values exist.

```
--text-xs     11px    Badges, tags, captions, shortcut hints
--text-sm     13px    Secondary text, sidebar items, timestamps
--text-base   15px    Body, messages, input text
--text-lg     18px    Section titles, conversation titles
--text-xl     22px    Page titles, major headings
```

Rules:
- 10px, 12px, 14px, 16px, 17px, 20px do not exist.
- When unsure, use --text-base (15px).
- No more than 3 size steps within a single component.

### 4.4 Weight scale

3 steps.

```
--weight-normal    400    Body, descriptions, regular text
--weight-medium    600    Emphasis, labels, sidebar section headers, button text
--weight-bold      700    Titles, headings, project names
```

Rules:
- 100, 200, 300, 500, 800, 900 are not used. Exception: logo Nunito at 900.
- Prefer color emphasis (--text-primary vs --text-secondary) over weight emphasis.

### 4.5 Line height

3 steps.

```
--leading-tight     1.3    Headings, single-line text
--leading-normal    1.5    Body, messages, multi-line text
--leading-relaxed   1.7    Long-form documents, markdown rendering, read-only content
```

Code blocks use --leading-normal (1.5), fixed.

### 4.6 Letter spacing

Default: 0 (no adjustment). Exceptions:

```
--text-xs (11px) and below:  +0.02em   Readability at small sizes
--text-xl (22px) and above:  -0.01em   Natural tightening at large sizes
All-caps labels:             +0.05em   e.g., "CONVERSATIONS", "KNOWLEDGE"
```

### 4.7 Markdown rendering

```
# h1   -> --text-xl (22px), --weight-bold, --leading-tight
## h2  -> --text-lg (18px), --weight-bold, --leading-tight
### h3 -> --text-base (15px), --weight-bold, --leading-tight
h4-h6  -> --text-base (15px), --weight-medium, --leading-tight
p      -> --text-base (15px), --weight-normal, --leading-relaxed
li     -> --text-base (15px), --weight-normal, --leading-normal
code   -> --text-sm (13px), Roboto Mono, --leading-normal
```

h3-h6 share the same size intentionally. 4+ heading levels are visually indistinguishable on the web.

Inline code and code blocks share the same background color, but code blocks use --bg-input while inline code uses the same color at 50% opacity.

---

## 5. Spacing

### 5.1 Design intent

Spacing is rhythm. Like music has beats, UI has spacing beats. Consistent multiples create a sense of order that users feel without noticing.

### 5.2 Scale

4px base, 6 steps. Only these values exist.

```
--space-1     4px     Micro spacing. Icon-to-text gaps.
--space-2     8px     Internal padding. Between list items.
--space-3    12px     Component gaps. Between items within a section.
--space-4    16px     Section gaps. Card internal padding.
--space-5    24px     Region gaps. Between major sections.
--space-6    32px     Page-level spacing. Modal internal padding.
```

Rules:
- 6px, 10px, 14px, 18px, 20px do not exist.
- Same scale for padding and margin.
- When two gaps are stacked vertically, the larger one should be at least 2x the smaller one for visible hierarchy.

### 5.3 Component spacing

**Buttons**
```
Height: 32px (small), 36px (medium), 44px (large)
Horizontal padding: --space-3 (12px)
Icon-to-text gap: --space-1 (4px)
Button-to-button gap: --space-2 (8px)
```

**List items (sidebar sessions, file lists)**
```
Height: 36px (single row), auto (multi-row)
Horizontal padding: --space-3 (12px)
Item-to-item gap: --space-1 (4px)
Group-to-group gap: --space-4 (16px)
```

**Cards**
```
Internal padding: --space-4 (16px)
Card-to-card gap: --space-3 (12px)
Element-to-element within card: --space-2 (8px)
```

**Input fields**
```
Height: 36px (single row)
Horizontal padding: --space-3 (12px)
Label-to-input gap: --space-1 (4px)
Field-to-field gap: --space-3 (12px)
```

**Modals/Dialogs**
```
Internal padding: --space-6 (32px)
Title-to-body gap: --space-4 (16px)
Body-to-actions gap: --space-5 (24px)
Action-to-action gap: --space-2 (8px)
```

**Message bubbles**
```
Internal padding: --space-3 (12px) horizontal, --space-2 (8px) vertical
Same-sender gap: --space-2 (8px)
Different-sender gap: --space-4 (16px)
Message area horizontal padding: --space-4 (16px)
```

---

## 6. Layout

### 6.1 Desktop structure

Three columns.

```
+----------+--------------+-----------------------------+
|          |              |                             |
|  Strip   |   Sidebar    |        Main                 |
|  (fixed) |  (resizable) |       (remaining)           |
|          |              |                             |
+----------+--------------+-----------------------------+
```

```
Strip:    56px fixed. No collapse/expand.
Sidebar:  240px default. Min 192px, max 320px. Collapsible to 0px.
Main:     Remaining width. Content max-width 760px.
```

Rules:
- Strip is always visible. On mobile it transforms to a bottom tab bar, it never disappears.
- Sidebar-Main boundary is draggable within min/max constraints.
- Main content exceeding 760px gets horizontal margins, not wider content.

### 6.2 Settings scope principle

Settings screens override proportional to their scope.

```
+----------------------------------------------------------+
|                                                          |
|  Server settings = full screen override                  |
|  +----------------------------------------------------+  |
|  |                                                    |  |
|  |  Project settings = main content area only         |  |
|  |  +----------------------------------------------+  |  |
|  |  |                                              |  |  |
|  |  |  Session settings = inline (within session)  |  |  |
|  |  |                                              |  |  |
|  |  +----------------------------------------------+  |  |
|  |                                                    |  |
|  +----------------------------------------------------+  |
|                                                          |
+----------------------------------------------------------+
```

```
Server settings:    Full screen. Replaces Strip, Sidebar, Main. Highest scope.
Project settings:   Main area only. Strip and Sidebar remain. Medium scope.
Session settings:   Inline. Within the conversation flow. Lowest scope.
```

Rules:
- Higher scope = wider override. Never invert.
- Returning from server settings restores previous screen state. No state loss.
- Project settings maintain sidebar navigation context. User never loses their "where am I."
- Session-level settings never use modals or separate screens. Natural within conversation flow.

---

## 7. Shape

### 7.1 Border radius

3 steps.

```
--radius-sm     4px     Small: badges, tags, inline code, scrollbars
--radius-md     8px     Medium: buttons, inputs, cards, message bubbles, dropdown items
--radius-lg    12px     Large: modals, panels, large cards, popovers
```

Rules:
- 6px, 10px, 14px, 16px, 20px do not exist.
- 50% is only for avatars and status indicators.
- Larger elements get larger radii. Small elements with --radius-lg look like balloons.
- Nested elements: inner radius <= outer radius. Modal (12px) contains button (8px). Never invert.

### 7.2 Borders

```
Width: 1px. Always. No exceptions.
Style: solid. Always. No dashed, no dotted.
Color: --border-default or --border-subtle only.
```

Exceptions:
- Active tab left indicator: 3px solid --color-accent. This is an indicator, not a border.
- Focus ring: 2px solid --color-accent. This is a focus marker, not a border.

### 7.3 Dividers

```
Horizontal: 1px solid --border-subtle, with --space-3 (12px) horizontal margin
Vertical: Do not use. Separate with background color differences.
```

---

## 8. Elevation

### 8.1 Design intent

Elevation shows attention priority, not physical depth. Higher elevation means "focus here now."

### 8.2 Levels

4 levels.

```
Level 0  Flat        No shadow                Body content, list items
Level 1  Raised      --shadow-sm              Dropdowns, tooltips, toasts
Level 2  Floating    --shadow-md              Popovers, context menus
Level 3  Top         --shadow-lg              Modals, full-screen overlays
```

Shadow values:
```
--shadow-sm:   0 2px 8px rgba(var(--shadow-rgb), 0.15)
--shadow-md:   0 4px 16px rgba(var(--shadow-rgb), 0.25)
--shadow-lg:   0 8px 32px rgba(var(--shadow-rgb), 0.35)
```

Rules:
- Shadows always cast downward. No upward/left/right shadows.
  - Exception: Input area pinned to bottom may use upward shadow (0 -2px 8px).
- Shadow color always uses --shadow-rgb. No hardcoded rgba(0,0,0,x).
- Higher elevation elements always have higher z-index. Shadow and z-index must agree.

### 8.3 Z-Index

```
--z-base        0       Normal content
--z-sticky      100     Fixed headers, fixed bottom bars
--z-dropdown    200     Dropdowns, tooltips
--z-popover     300     Popovers, context menus
--z-modal       400     Modals
--z-overlay     500     Full-screen overlays (modal backdrops)
--z-toast       600     Toast notifications (always on top)
```

Rules:
- No arbitrary z-index (999, 9999, 99999). Always use these variables.
- Same-level ordering: use +1, +2 offsets (e.g., --z-dropdown + 1).

---

## 9. Motion

### 9.1 Design intent

Motion is not decoration. It serves exactly two roles:
1. **Feedback**: "Your action was received."
2. **Continuity**: "Here's where you came from and where you're going."

Motion that serves neither role is removed.

### 9.2 Duration

2 steps.

```
--duration-fast    150ms    State changes. Hover, focus, color transitions, toggles.
--duration-slow    250ms    Structural changes. Open/close, slide, expand/collapse.
```

Rules:
- 100ms, 200ms, 300ms, 350ms, 500ms do not exist.
- Below 150ms, users cannot perceive the change. Above 250ms, it feels slow.
- Exception: Looping animations (spinners, pulse) at 1s-2s. These are state indicators, not transitions.

### 9.3 Easing

2 curves only.

```
--ease-out     cubic-bezier(0.16, 1, 0.3, 1)     Appearing. Fast start, smooth finish.
--ease-in-out  cubic-bezier(0.4, 0, 0.2, 1)      State changes. Smooth start and finish.
```

Rules:
- `linear` only for spinner rotation.
- CSS default `ease` is never used. Always specify explicitly.
- `ease-in` is never used. Elements that stop abruptly feel broken.

### 9.4 Transition targets

```
Allowed:   background-color, color, border-color, opacity, transform, box-shadow
Forbidden: width, height, padding, margin, font-size, top/left/right/bottom
```

Size/position changes use transform (scale, translate). Width/height animations cause layout recalculation.

Exception: Sidebar resize and textarea height are real-time (drag/type), so they apply instantly with no transition.

### 9.5 Enter/exit patterns

```
Dropdown:   opacity 0->1 + translateY(-4px->0),  --duration-fast, --ease-out
Modal:      opacity 0->1 + scale(0.97->1),       --duration-slow, --ease-out
Toast:      opacity 0->1 + translateY(8px->0),    --duration-slow, --ease-out
Sidebar:    translateX(-100%->0),                  --duration-slow, --ease-out
```

Exit is the reverse of enter, but 20% shorter. Disappearing should feel faster than appearing.

---

## 10. Interaction States

### 10.1 Five states

Every interactive element has 5 states, each visually distinct.

```
Default     No interaction.
Hover       Mouse over. Does not exist on touch devices.
Active      Pressed (mousedown/touchstart).
Focus       Keyboard focus via Tab.
Disabled    Non-interactive. Cannot click.
```

### 10.2 State visuals

**Primary button (accent background)**
```
Default:    background: --color-accent
Hover:      background: --color-accent lightened +8%
Active:     background: --color-accent darkened -5%
Focus:      + outline 2px solid --color-accent, offset 2px
Disabled:   opacity: 0.4, cursor: not-allowed
```

**Secondary button (transparent background)**
```
Default:    background: transparent
Hover:      background: --color-accent-subtle
Active:     background: --color-accent-muted
Focus:      + outline 2px solid --color-accent, offset 2px
Disabled:   opacity: 0.4, cursor: not-allowed
```

**List items (sidebar sessions)**
```
Default:    background: transparent
Hover:      background: --bg-raised lightened +3%
Selected:   background: --color-accent-subtle, border-left: 3px solid --color-accent
Focus:      + outline 2px solid --color-accent, offset -2px (inset)
```

**Input fields**
```
Default:    border: 1px solid --border-default
Hover:      border: 1px solid --border-default lightened +10%
Focus:      border: 1px solid --color-accent, box-shadow: 0 0 0 2px --color-accent-subtle
Disabled:   opacity: 0.4, background: --bg-raised
```

### 10.3 Touch device rules

- Hover states are ignored on touch. Wrap in @media (hover: hover).
- On touch devices, active state replaces hover's role.
- Minimum touch target: 44px x 44px. Visual size may be smaller if touch area is padded to 44px.

### 10.4 Focus rules

- Mouse-click focus does not show focus ring. Style only :focus-visible.
- Focus ring is always --color-accent. Never changes per element type.
- Focus ring is drawn outside the element with 2px offset. Inside would obscure content.
  - Exception: Elements inside overflow:hidden containers use inset focus ring.

---

## 11. Icons

### 11.1 Sizes

3 steps.

```
--icon-sm     16px    Inline icons. Next to text, inside badges.
--icon-md     20px    Standalone icons. Sidebar menus, inside buttons.
--icon-lg     24px    Emphasis icons. Empty state illustrations, headers.
```

Rules:
- Icons are always square: 16x16, 20x20, 24x24.
- Icon-to-adjacent-text vertical alignment: center.
- Icon-only buttons: icon size + --space-2 (8px) padding = total touch area.
  - 16px icon -> 32px button
  - 20px icon -> 36px button
  - 24px icon -> 40px button

### 11.2 Style

- Icon color follows text hierarchy. Primary icons use --text-primary, secondary use --text-muted.
- No custom colors on icons. Exception: semantic color icons (accent, success, error, warning).
- Emoji used as icons get a drop-shadow filter for visibility.

---

## 12. Mobile

### 12.1 Mobile philosophy

Mobile Clay is not desktop Clay scaled down. It is **a different product with the same soul**.

Desktop shows multiple things simultaneously (Strip + Sidebar + Main). Mobile shows **one thing at a time**. This difference changes not just layout, but the entire order and method of presenting information.

Clay's mobile killer point: "Work with your AI teammates from your phone." This is the north star for every mobile design decision. Terminal and file browser do not need to be perfect on mobile. But **chatting, reviewing, and approving** must be native-app quality.

### 12.2 Three mobile principles

**1. One Thing at a Time**
Every mobile screen has a single purpose. "Viewing session list" or "having a conversation" or "selecting a file." Never simultaneously.

**2. Navigate by Depth**
Desktop navigates laterally (sidebar > main). Mobile navigates forward and backward (list > detail > deeper detail). Like iOS navigation stacks. Back always returns to the previous screen.

**3. Thumb Zone**
The bottom third of the screen is easiest to reach. Core interactions (message input, tab switching, primary actions) must all live in this zone. The top area is for information display.

### 12.3 Breakpoint

```
--bp-mobile    768px and below    Mobile. Single column, bottom tab bar.
--bp-desktop   769px and above    Desktop/tablet. Full layout.
```

Rules:
- 768px is the current codebase breakpoint. Maintained.
- Tablets are treated as desktop.
- No intermediate breakpoints (480px, 640px, 1024px). Exception: Scheduler may adjust at 600px.

### 12.4 Mobile navigation

Desktop's 3-column layout becomes **bottom tab bar + full-screen views** on mobile.

```
+-------------------------+
|  Title bar (context)    |  <- current location, back button
+-------------------------+
|                         |
|                         |
|   Main content          |  <- one thing at a time
|                         |
|                         |
+-------------------------+
|  Input area (in chat)   |  <- thumb zone
+-------------------------+
|  Bottom tab bar         |  <- fixed at bottom
+-------------------------+
```

**Tab bar:**
```
[ Home ]  [ Sessions ]  [ + ]  [ Tools ]  [ More ]
```

Rules:
- 5 tabs maximum. Overflow goes into "More."
- Active tab: --color-accent. Inactive: --text-muted.
- Badges on tab icons: top-right, minimum 18px.
- When keyboard opens, tab bar hides. Only input area sits above keyboard.

### 12.5 Screen transitions

**Horizontal (same level):** Instant, no animation. Tab bar indicates current location.

**Vertical (depth navigation):**
- List to detail: slide in from right (--duration-slow, --ease-out)
- Detail to list: slide out to right
- Back: top-left back button or swipe-back (avoid conflict with iOS native gestures)

**Overlay:**
- Sheet modal: slide up from bottom. Drag to dismiss.
- Full-screen modal: slide up from bottom, close button top-left.
- All overlays require translucent backdrop.

### 12.6 Mobile components

#### Chat (highest priority)

Chat is the core mobile experience. Must match native messenger quality.

```
Message bubbles:    max-width: 90%. Wider than desktop.
Input area:         Pinned to bottom. Respects safe-area-inset-bottom.
Keyboard handling:  Input area moves above keyboard. Scroll position preserved.
Image attachments:  Horizontal scroll preview above input.
Code blocks:        Horizontal scroll. No forced line wrapping.
Copy button:        Always visible on code blocks (not hover-triggered).
```

#### Mate DM (highest priority)

Mate DM will be the most-used mobile screen. Same structure as regular chat, but Mate's presence must be felt.

```
+-------------------------+
| <- [avatar] Jeni  * ...  |  <- Mate info + status
+-------------------------+
|                         |
|  Conversation           |
|                         |
+-------------------------+
|  Message input     [>]  |
+-------------------------+
|  Tab bar                |
+-------------------------+
```

Rules:
- Title bar shows Mate avatar, name, status. Tap to open Mate profile sheet.
- Mate profile sheet: access Knowledge, Skills, Sticky Notes, Scheduled Tasks.
- Opening a Knowledge file: full-screen editor. Back button returns to conversation.
- Editor and preview: **tab switch**, never simultaneous (screen too narrow).

```
Knowledge editor (mobile):
+-------------------------+
| <- competitive-landscape|
+-------------------------+
| [ Edit ]  [ Preview ]   |  <- tab switch
+-------------------------+
|                         |
|  Editor OR preview      |
|  (one at a time)        |
|                         |
+-------------------------+
```

#### Terminal (secondary)

Mobile terminal is for checking and light interaction, not heavy coding.

```
Full screen. Tab bar hidden.
Terminal tabs at top.
Special key bar at bottom (Ctrl, Tab, Esc, arrow keys).
Close button top-right.
```

Rules:
- Terminal font: --text-sm (13px) minimum.
- Special key bar: horizontal scroll above keyboard.
- Terminal output: horizontal scroll. No forced line wrapping.

#### File browser (secondary)

```
Full screen.
File tree: vertical scroll.
File selection: full-screen viewer. Back to return.
```

Rules:
- File tree items: minimum 44px height.
- Directory expand/collapse on tap.
- Syntax highlighting preserved in viewer. Horizontal scroll allowed.

#### Settings (secondary)

Applying section 6.2 scope principle on mobile:

```
Server settings:    Full screen. Left nav becomes top tabs or section scroll.
Project settings:   Full screen (on mobile, main area = full screen).
Session settings:   Sheet modal or inline.
```

### 12.7 Gestures

```
Swipe right (left-to-right):  Back. Same as iOS native.
Swipe down (on sheet):        Dismiss sheet modal. Start from drag handle.
Long press:                   Context menu (rename session, delete, etc.).
Pinch zoom:                   Disabled. Viewport locked (user-scalable=no).
Pull to refresh:              Disabled. Real-time WebSocket makes it unnecessary.
```

Rules:
- Custom gestures must not conflict with OS-native gestures.
- Swipe left (right-to-left) is not used. Delete-swipe patterns risk accidents.
- Every gesture action must also be accessible via buttons. Gestures are shortcuts, not the only path.

### 12.8 Safe areas

```
--safe-top:     env(safe-area-inset-top)     Notch, dynamic island
--safe-bottom:  env(safe-area-inset-bottom)  Home indicator
--safe-left:    env(safe-area-inset-left)    Landscape mode
--safe-right:   env(safe-area-inset-right)   Landscape mode
```

Rules:
- Title bar top padding: --safe-top
- Tab bar bottom padding: --safe-bottom
- Input area bottom padding: --safe-bottom (when no tab bar)
- Landscape mode is supported but not optimized. Portrait is default.

### 12.9 Mobile typography

Font size scale is identical to desktop (--text-xs through --text-xl). Adjustments:

```
Message body:        --text-base (15px). Never smaller.
Sheet list items:    --text-base (15px). One step larger than desktop sidebar.
Badges/tags:         --text-xs (11px). Same as desktop.
```

Rules:
- No text smaller than --text-xs (11px) on mobile.
- Touchable text (links, button labels): --text-sm (13px) minimum.

### 12.10 Mate presence on mobile

Desktop shows Mate list in the sidebar at all times. Mobile has no space for this, so presence is achieved differently.

**Access paths:**
```
1. Tab bar "Home" -> Mate cards
2. @mention in project conversation
3. Home screen: horizontal scroll of Mate avatars at top
```

**Status indicators:**
```
Home screen:     Status dot on Mate avatar (green/orange)
Chat screen:     Status text in title bar ("responding...", "online")
Push notification: Mate avatar as notification icon
```

Rules:
- Reaching a Mate takes 2 taps maximum. Home > Mate, or Session > @mention.
- Switching between Mate DMs also takes 2 taps maximum.
- Mate avatars on mobile: 32px minimum. 24px is too small.
- Push notifications include Mate name and avatar. "Jeni responded," not "Notification from Clay."

---

## 13. State Screens

### 13.1 Empty states

Empty screens do not exist. Every empty state includes:

```
1. What can go here (explanation)
2. How to start (action)
```

```
Bad:   "No sessions."
Good:  "No conversations yet. Send your first message below."
```

Rules:
- Empty state text: --text-muted, --text-sm.
- If an action exists, provide it as a text link or button.
- Optional illustration/emoji at --icon-lg (24px).

### 13.2 Loading states

```
Full page:        Center spinner (24px). No text.
Partial loading:  Skeleton UI matching actual content layout.
Inline loading:   Small spinner (16px) next to text, or three-dot pulse.
Button loading:   Button text replaced with spinner. Button size maintained.
```

Rules:
- If loading is expected to complete within 300ms, show no loading indicator. A flash is worse.
- Skeleton UI must reflect actual content layout. No random gray blocks.
- Loading should not block user interaction. Keep things async where possible.

### 13.3 Error states

```
Inline error:     Below input field, --color-error, --text-xs.
Toast error:      Bottom-right, --color-error background, auto-dismiss after 5s.
Full-page error:  Center message + retry button.
```

Rules:
- Error messages include what went wrong AND how to fix it.
- No raw error codes (500, ECONNREFUSED) shown to users. Technical details in a collapsible "details" section (acceptable since this is a developer tool).

---

## 14. Accessibility

### 14.1 Color contrast

```
Body text (--text-primary):          Minimum 4.5:1 against background (WCAG AA)
Large text (--text-xl and above):    Minimum 3:1
Icons, borders:                      Minimum 3:1
Semantic colors:                     Minimum 4.5:1 on their respective backgrounds
```

### 14.2 Keyboard navigation

```
Tab:          Next interactive element
Shift+Tab:    Previous interactive element
Enter/Space:  Click button, select item
Escape:       Close modal/dropdown/popover
Arrow Keys:   Navigate within lists, switch tabs
```

Rules:
- Every interactive element must be reachable via Tab.
- Tab order matches visual order. Left-to-right, top-to-bottom.
- When a modal is open, Tab must not reach elements behind it (focus trap).

### 14.3 Screen readers

```
Images:              alt text required
Icon-only buttons:   aria-label required
State changes:       aria-live="polite"
Modals:              role="dialog", aria-modal="true"
```

### 14.4 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  All transitions: 0ms
  All animations: none
  Scroll behavior: auto (no smooth)
}
```

---

## 15. Mate Identity

### 15.1 Avatar

```
Size: 32px (sidebar, lists), 40px (chat header), 24px (inline mentions)
Shape: Circle (border-radius: 50%)
Background: Mate's unique color or image
```

Rules:
- Mates without avatars use their name's first character.
- Avatar images always use object-fit: cover. No distortion.
- In conversation, consecutive messages from the same Mate show the avatar only on the first message.

### 15.2 Status indicators

```
Online/active:    Green dot (8px, --color-success) at avatar bottom-right
Responding:       Orange dot (8px, --color-warning) + pulse animation
Offline:          No dot
```

### 15.3 Conversation display

```
Mate name:         Top of message group, --text-sm, --weight-medium, Mate's unique color
Message bubble:    No background (assistant messages are transparent). Only user messages have bubbles.
Typing indicator:  Three-dot animation below Mate name.
```

---

## 16. Rules Summary

1. **No hardcoded colors.** All colors through CSS variables. Only exception: text selection color.
2. **No UI gradients.** Backgrounds, buttons, borders are solid colors. Logo and brand marks are exceptions.
3. **No text shadows.** text-shadow is forbidden.
4. **No borders wider than 1px.** Indicators are not borders.
5. **No !important.** Solve with specificity.
6. **No inline styles.** Exceptions: dynamic values (Mate colors, sidebar width).
7. **No in-between values.** 6px, 10px, 14px, 200ms, 300ms do not exist.
8. **No decorative content.** No background patterns, watermarks, or ornamental images.
9. **No scroll hijacking.** No custom scroll speeds or snap points. Scrollbar styling is allowed.
10. **No exceptions.** If a component "needs something special," the system expands to accommodate it. The component does not break the system.

---

## 17. Variable Reference

These variables are the complete Clay design system. No values exist outside this list.

### Colors (theme-dependent values defined per theme)
```
--bg-base
--bg-raised
--bg-overlay
--bg-input

--text-primary
--text-secondary
--text-muted
--text-disabled

--border-default
--border-subtle

--color-accent
--color-accent-subtle       (8%)
--color-accent-muted        (15%)
--color-accent-strong       (25%)

--color-success / -subtle / -muted / -strong
--color-error   / -subtle / -muted / -strong
--color-warning / -subtle / -muted / -strong

--shadow-rgb
--overlay-rgb
```

### Typography
```
--text-xs:          11px
--text-sm:          13px
--text-base:        15px
--text-lg:          18px
--text-xl:          22px

--weight-normal:    400
--weight-medium:    600
--weight-bold:      700

--leading-tight:    1.3
--leading-normal:   1.5
--leading-relaxed:  1.7
```

### Spacing
```
--space-1:    4px
--space-2:    8px
--space-3:   12px
--space-4:   16px
--space-5:   24px
--space-6:   32px
```

### Shape
```
--radius-sm:    4px
--radius-md:    8px
--radius-lg:   12px
```

### Elevation
```
--shadow-sm:   0 2px 8px rgba(var(--shadow-rgb), 0.15)
--shadow-md:   0 4px 16px rgba(var(--shadow-rgb), 0.25)
--shadow-lg:   0 8px 32px rgba(var(--shadow-rgb), 0.35)

--z-base:       0
--z-sticky:     100
--z-dropdown:   200
--z-popover:    300
--z-modal:      400
--z-overlay:    500
--z-toast:      600
```

### Motion
```
--duration-fast:   150ms
--duration-slow:   250ms

--ease-out:        cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out:     cubic-bezier(0.4, 0, 0.2, 1)
```

### Icons
```
--icon-sm:    16px
--icon-md:    20px
--icon-lg:    24px
```

### Layout
```
--strip-width:       56px
--sidebar-width:     240px
--sidebar-min:       192px
--sidebar-max:       320px
--content-max:       760px
--bp-mobile:         768px
```

---

## 18. Asset Inventory

```
design/media/logo/
+-- clay-wordmark-banded.png          # Primary wordmark
+-- clay-wordmark-gradient.png        # Secondary wordmark
+-- icon-banded-{128..1024}.png       # Banded C icon (solid bg)
+-- icon-gradient-{128..1024}.png     # Gradient C icon (solid bg)
+-- icon-*-transparent.png            # Transparent background variants
+-- favicon-{16,32,48}.png            # Favicon PNGs
+-- favicon.ico                       # Multi-size ICO

lib/public/
+-- favicon-banded.png                # Active favicon (16x16)
+-- wordmark-banded-{20,32,64}.png    # Topbar wordmark
+-- apple-touch-icon.png              # iOS icon (180x180)
+-- apple-touch-icon-dark.png         # iOS icon dark
+-- icon-192.png / icon-512.png       # PWA icons
+-- icon-192-dark.png / icon-512-dark.png
```
