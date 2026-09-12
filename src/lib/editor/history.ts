export type History<T> = { past: T[]; present: T; future: T[] };
export type HistoryAction<T> =
  { type: "commit"; value: T } | { type: "undo" } | { type: "redo" } | { type: "reset"; value: T };
export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  if (action.type === "reset") return { past: [], present: action.value, future: [] };
  if (action.type === "commit") {
    if (JSON.stringify(state.present) === JSON.stringify(action.value)) return state;
    return { past: [...state.past.slice(-49), state.present], present: action.value, future: [] };
  }
  if (action.type === "undo" && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  if (action.type === "redo" && state.future.length)
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  return state;
}
