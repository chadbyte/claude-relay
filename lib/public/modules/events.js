// EventBus — lightweight pub/sub for module decoupling
export class EventBus {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] || (this._listeners[event] = [])).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    var list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  }

  emit(event, data) {
    var list = this._listeners[event];
    if (list) list.forEach(fn => fn(data));
  }
}
