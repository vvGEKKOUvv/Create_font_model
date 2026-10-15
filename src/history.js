// Snapshots retain immutable SVG shapes; mutable editing state is copied by the caller.
export function createHistory({
  capture,
  restore,
  onChange = () => {},
  delay = 300,
  limit = 60,
  fingerprint,
}) {
  let past = [],
    future = [],
    present = capture(),
    timer = null,
    restoring = false;
  const key =
    fingerprint ||
    ((state) =>
      JSON.stringify(state, (name, value) =>
        name === "shape" ? undefined : value,
      ));
  let presentKey = key(present);
  function cancelTimer() {
    clearTimeout(timer);
    timer = null;
  }
  function commit() {
    cancelTimer();
    if (restoring) return;
    const next = capture(),
      nextKey = key(next);
    if (nextKey === presentKey) {
      // Keep current selection/view metadata without creating an undo step.
      present = next;
      return;
    }
    past.push(present);
    if (past.length > limit) past.shift();
    present = next;
    presentKey = nextKey;
    future = [];
    onChange();
  }
  function record() {
    if (restoring) return;
    cancelTimer();
    timer = setTimeout(commit, delay);
  }
  function travel(backward) {
    commit();
    const source = backward ? past : future,
      destination = backward ? future : past;
    if (!source.length) return false;
    const target = source[source.length - 1];
    restoring = true;
    try {
      restore(target);
      source.pop();
      destination.push(present);
      present = target;
      presentKey = key(present);
    } finally {
      restoring = false;
    }
    onChange();
    return true;
  }
  return {
    record,
    commit,
    undo: () => travel(true),
    redo: () => travel(false),
    get pending() {
      return timer !== null;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    dispose() {
      cancelTimer();
    },
  };
}
