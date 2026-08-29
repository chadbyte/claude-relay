var tool = {
  initialState: { source: '', result: '', direction: 'ko-en', history: [] },
  actions: {
    load: async function (state, args, api) {
      var history = await api.storage.list();
      history.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return { source: state.source || '', result: state.result || '', direction: state.direction || 'ko-en', history: history };
    },
    setSource: function (state, args) {
      return Object.assign({}, state, { source: args.value || '' });
    },
    setDirection: function (state, args) {
      return Object.assign({}, state, { direction: args.value === 'en-ko' ? 'en-ko' : 'ko-en' });
    },
    translate: async function (state, args, api) {
      var source = (state.source || '').trim();
      if (!source) return state;
      var direction = state.direction === 'en-ko' ? 'English to Korean' : 'Korean to English';
      var result = await api.llm.complete({
        system: 'Translate ' + direction + '. Return only the translation.',
        prompt: source,
        model: 'fast'
      });
      await api.storage.put({ source: source, result: result, direction: state.direction, at: Date.now() });
      var history = await api.storage.list();
      history.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return Object.assign({}, state, { result: result, history: history });
    },
    remove: async function (state, args, api) {
      await api.storage.delete(args.id);
      var history = await api.storage.list();
      history.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return Object.assign({}, state, { history: history });
    }
  }
};
