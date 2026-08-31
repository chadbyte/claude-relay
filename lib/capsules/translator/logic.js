var SETTINGS_ID = 'translator-settings';

function isModelAlias(value) {
  return value === 'fast' || value === 'standard' || value === 'deep';
}

function translationHistory(records) {
  var history = records.filter(function (record) { return record._id !== SETTINGS_ID; });
  history.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  return history;
}

var tool = {
  initialState: { source: '', result: '', direction: 'ko-en', model: 'fast', history: [] },
  actions: {
    load: async function (state, args, api) {
      var settings = await api.storage.get(SETTINGS_ID);
      var history = translationHistory(await api.storage.list());
      var model = settings && isModelAlias(settings.model) ? settings.model : isModelAlias(state.model) ? state.model : 'fast';
      return { source: state.source || '', result: state.result || '', direction: state.direction || 'ko-en', model: model, history: history };
    },
    setSource: function (state, args) {
      return Object.assign({}, state, { source: args.value || '' });
    },
    setDirection: function (state, args) {
      return Object.assign({}, state, { direction: args.value === 'en-ko' ? 'en-ko' : 'ko-en' });
    },
    setModel: async function (state, args, api) {
      var model = isModelAlias(args.value) ? args.value : 'fast';
      await api.storage.put({ _id: SETTINGS_ID, type: 'settings', model: model });
      return Object.assign({}, state, { model: model });
    },
    translate: async function (state, args, api) {
      var source = (state.source || '').trim();
      if (!source) return state;
      var direction = state.direction === 'en-ko' ? 'English to Korean' : 'Korean to English';
      var result = await api.llm.complete({
        system: 'Translate ' + direction + '. Return only the translation.',
        prompt: source,
        model: isModelAlias(state.model) ? state.model : 'fast'
      });
      await api.storage.put({ source: source, result: result, direction: state.direction, at: Date.now() });
      var history = translationHistory(await api.storage.list());
      return Object.assign({}, state, { result: result, history: history });
    },
    remove: async function (state, args, api) {
      await api.storage.delete(args.id);
      var history = translationHistory(await api.storage.list());
      return Object.assign({}, state, { history: history });
    }
  }
};
