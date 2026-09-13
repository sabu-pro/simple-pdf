// Runtime APIs used by pdfjs-dist 6's modern display and worker bundles.
// Check capabilities, not the user agent: mobile WebKit versions differ widely.
type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

export function ensurePromiseWithResolvers(
  promiseConstructor = Promise as PromiseConstructorWithResolvers,
) {
  if (typeof promiseConstructor.withResolvers === "function") return;
  Object.defineProperty(promiseConstructor, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    },
  });
}

export function needsLegacyPdfJs() {
  return (
    typeof (Promise as PromiseConstructorWithResolvers).withResolvers !== "function" ||
    typeof globalThis.Iterator === "undefined" ||
    [
      "filter",
      "map",
      "take",
      "drop",
      "flatMap",
      "toArray",
      "forEach",
      "some",
      "every",
      "find",
    ].some((method) => typeof Reflect.get(Iterator.prototype, method) !== "function") ||
    typeof Map.prototype.getOrInsertComputed !== "function" ||
    typeof Map.prototype.getOrInsert !== "function" ||
    typeof WeakMap.prototype.getOrInsertComputed !== "function" ||
    typeof Uint8Array.prototype.toHex !== "function" ||
    typeof Uint8Array.prototype.toBase64 !== "function" ||
    typeof Uint8Array.fromBase64 !== "function" ||
    typeof Set.prototype.union !== "function" ||
    typeof Set.prototype.intersection !== "function" ||
    typeof Set.prototype.difference !== "function" ||
    typeof Promise.try !== "function" ||
    typeof Reflect.get(Math, "sumPrecise") !== "function" ||
    typeof URL.parse !== "function"
  );
}
