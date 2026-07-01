// What's New entries.
//
// Pure content. Each entry becomes one card in the carousel popup and
// one row in the home page's "What's New" feed. Append a new entry to
// push it to users on their next connect; the viewer queues unseen
// entries and shows them as a carousel one user can flip through.
//
// Each entry:
//   id          - stable string. Used as the "seen" key. Never reuse an
//                 id for different content - users who already dismissed
//                 the old one will not see the new one.
//   title       - headline shown in the carousel card and home feed.
//   publishedAt - YYYY-MM-DD. Used for sort order (newest first) in the
//                 home feed and the carousel.
//   image       - optional URL. If present, shown as a banner at the top
//                 of the carousel card and the home entry. Drop a file
//                 under lib/public/whats-new/ and reference it as
//                 "/whats-new/<filename>".
//   summary     - 1-2 sentences. The carousel card body. Keep it short.
//   body        - full HTML for the home-page detail view. Use the same
//                 small allowed vocabulary as tui-policy-modal-body:
//                 <p>, <ul>/<ol>/<li>, <strong>, <em>, <code>, <h3>, <a>.

var ENTRIES = [
  {
    id: "2026-06-tui-default",
    title: "TUI becomes the default for Claude sessions",
    publishedAt: "2026-05-25",
    image: null,
    popup: false, // superseded by "GUI is back"; keep in the home feed only
    summary: "Anthropic is splitting Claude billing into Interactive and Programmatic buckets on June 15. To keep working with your existing plan, Clay opens Claude sessions in the embedded claude CLI by default from that date.",
    body: '' +
      '<p><strong>2026-06-15 Anthropic billing change.</strong> Claude subscriptions split into two buckets:</p>' +
      '<ul>' +
        '<li><strong>Interactive</strong> &mdash; <code>claude.ai</code> chat, the terminal <code>claude</code> CLI, Claude Cowork. Uses your existing plan limits.</li>' +
        '<li><strong>Programmatic</strong> &mdash; Claude Agent SDK, <code>claude -p</code>, GitHub Actions, and third-party apps built on the SDK. Charged at full API rates against a small monthly credit (Pro $20 &middot; Max 5x $100 &middot; Max 20x $200), no rollover.</li>' +
      '</ul>' +
      '<p>Clay\'s original chat UI is SDK-driven, so every message lands in the Programmatic bucket. Heavy users would burn through the credit in days.</p>' +
      '<p><strong>TUI mode</strong> runs the real <code>claude</code> CLI inside an embedded terminal. Usage stays in the Interactive bucket, so it counts against your existing plan instead of the SDK credit.</p>' +
      '<h3>Want the SDK chat instead?</h3>' +
      '<p>Switch back to GUI mode anytime:</p>' +
      '<ol>' +
        '<li>Open your avatar &rarr; <strong>Settings</strong> at the bottom of the sidebar.</li>' +
        '<li>Find <strong>"Open Claude as terminal (TUI)"</strong> and toggle it <strong>off</strong>.</li>' +
      '</ol>' +
      '<p class="tui-policy-modal-links">' +
        '<a href="https://the-decoder.com/claude-subscriptions-get-separate-budgets-for-programmatic-use-billed-at-full-api-prices/" target="_blank" rel="noopener noreferrer">Coverage at The Decoder</a>' +
        ' &middot; ' +
        '<a href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan" target="_blank" rel="noopener noreferrer">Anthropic help center</a>' +
        ' &middot; ' +
        '<a href="https://github.com/chadbyte/clay" target="_blank" rel="noopener noreferrer">github.com/chadbyte/clay</a>' +
      '</p>',
  },
  {
    id: "2026-06-mates-spinoff",
    title: "Mates leaves the official feature set",
    publishedAt: "2026-05-25",
    image: null,
    popup: false, // superseded by "GUI is back"; keep in the home feed only
    summary: "June 15 will be Mates' last day as a first-class Clay feature. It continues as a separate standalone project so Clay can focus fully on being a developer tool.",
    body: '' +
      '<p>On <strong>2026-06-15</strong>, Mates leaves Clay\'s official feature set. Your existing Mates and their knowledge files will remain on disk; we will share migration instructions and a link to the new standalone project before the cutover.</p>' +
      '<h3>Why</h3>' +
      '<p>Mates grew into something broader than a coding companion - personas, debates, DMs, identity files. That is a different product shape than a focused dev tool, and trying to be both was slowing each side down.</p>' +
      '<p>We are formally positioning Clay as a <strong>developer tool</strong>. From here on, every roadmap decision is judged by a single question: does it make Clay the sleekest, sharpest workspace on the AI-coding frontier? Mates no longer fits that bar cleanly, so it gets its own home where it can evolve on its own terms.</p>' +
      '<p>Thanks for being here. Clay only gets sharper from here.</p>',
  },
  {
    id: "2026-07-gui-is-back",
    title: "GUI is back as the default",
    publishedAt: "2026-07-01",
    image: null,
    summary: "Anthropic reversed the June 15 billing split, so SDK usage is no longer billed separately. Clay opens Claude sessions in the GUI chat again by default. Mates is now off by default as it winds down.",
    body: '' +
      '<p><strong>Good news: Anthropic walked back the June 15 billing change.</strong> The planned Interactive vs. Programmatic split (which would have charged Claude Agent SDK usage at full API rates) is off the table, so the reason we moved everyone to the TUI is gone.</p>' +
      '<h3>GUI is the default again</h3>' +
      '<p>New Claude sessions open in the <strong>GUI chat</strong> (SDK) by default, the way they did before. The embedded <code>claude</code> <strong>TUI</strong> is still there whenever you want it &mdash; toggle <strong>"Open Claude as terminal (TUI)"</strong> in Settings.</p>' +
      '<h3>Mates is off by default</h3>' +
      '<p>As announced, <strong>Mates</strong> is no longer a first-class Clay feature. It is now <strong>off by default</strong> so Clay stays focused as a developer tool. Your existing Mates and their knowledge files remain on disk &mdash; if you still use them, re-enable Mates in <strong>Settings</strong>.</p>' +
      '<p>Clay only gets sharper from here.</p>',
  },
];

module.exports = { ENTRIES: ENTRIES };
