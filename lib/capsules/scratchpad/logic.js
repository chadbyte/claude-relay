var tool = {
  initialState: { draft: '', filter: '', items: [] },
  actions: {
    load: async function (state, args, api) {
      return { draft: state.draft || '', filter: state.filter || '', items: await api.storage.list() };
    },
    setDraft: function (state, args) {
      return { draft: args.value || '', filter: state.filter || '', items: state.items || [] };
    },
    setFilter: function (state, args) {
      return { draft: state.draft || '', filter: args.value || '', items: state.items || [] };
    },
    add: async function (state, args, api) {
      var text = (state.draft || '').trim();
      if (!text) return state;
      await api.storage.put({ text: text, createdAt: Date.now() });
      return { draft: '', filter: state.filter || '', items: await api.storage.list() };
    },
    remove: async function (state, args, api) {
      await api.storage.delete(args.id);
      return { draft: state.draft || '', filter: state.filter || '', items: await api.storage.list() };
    }
  }
};
