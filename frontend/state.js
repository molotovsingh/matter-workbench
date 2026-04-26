export function createMutableState(initialValue) {
  let value = initialValue;
  return {
    get: () => value,
    set: (nextValue) => {
      value = nextValue;
      return value;
    },
    merge: (patch) => {
      value = { ...value, ...patch };
      return value;
    },
  };
}
