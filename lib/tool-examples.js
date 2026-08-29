var SCRATCHPAD = {
  manifest: {
    id: "scratchpad",
    name: "Scratchpad",
    lucideIcon: "notebook-pen",
    version: 1,
    initialAction: "load",
    example: true,
    skills: [
      "Use scratch-input with clay_tool_set to change the draft.",
      "Use the add action to persist the current draft and remove with an item id to delete a note.",
    ].join("\n"),
  },
  logicSource: [
    "var tool = {",
    "  initialState: { draft: '', items: [] },",
    "  actions: {",
    "    load: async function (state, args, api) {",
    "      return { draft: state.draft || '', items: await api.storage.list() };",
    "    },",
    "    setDraft: function (state, args) {",
    "      return { draft: args.value || '', items: state.items || [] };",
    "    },",
    "    add: async function (state, args, api) {",
    "      var text = (state.draft || '').trim();",
    "      if (!text) return state;",
    "      await api.storage.put({ text: text, createdAt: Date.now() });",
    "      return { draft: '', items: await api.storage.list() };",
    "    },",
    "    remove: async function (state, args, api) {",
    "      await api.storage.delete(args.id);",
    "      return { draft: state.draft || '', items: await api.storage.list() };",
    "    }",
    "  }",
    "};",
    "",
  ].join("\n"),
  uiTree: {
    type: "stack",
    props: { gap: "md" },
    children: [
      { type: "heading", props: { text: "Scratchpad", level: 2 } },
      { type: "row", children: [
        { type: "input", id: "scratch-input", bind: "draft", action: "setDraft", props: { label: "New note", placeholder: "Write something…" } },
        { type: "button", id: "add-note", action: "add", props: { label: "Add" } },
      ] },
      { type: "empty-state", bind: "items", props: { text: "No notes yet." } },
      { type: "list", bind: "items", children: [
        { type: "card", children: [
          { type: "row", children: [
            { type: "text", bind: "$item.text" },
            { type: "button", action: "remove", props: { label: "Delete", variant: "danger", args: { id: "$item._id" } } },
          ] },
        ] },
      ] },
    ],
  },
};

module.exports = { SCRATCHPAD: SCRATCHPAD };
