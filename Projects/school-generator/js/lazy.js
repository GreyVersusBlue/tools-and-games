// lazy.js — a module fetched the first time somebody asks for it.
//
// Everything in this tool used to be a static import, which meant everything
// was downloaded, parsed and evaluated before the first frame: 3.5 MB of
// JavaScript over ninety-nine requests, most of it for features behind a
// button nobody had pressed yet. Printing a sheet, exporting glTF, generating
// a school, sharing a session — each is a thing you might do once in a
// session, or never, and each was paid for on every load.
//
// Deferring one is a two-line change at the top of main.js and one `await` at
// the button, which is the whole reason this file is four lines long. It is a
// deliberate non-solution to the general problem: there is no build step here
// and there is not going to be one, so this is not a bundler, a chunk graph or
// a preload strategy. It is "don't fetch it until it's wanted", once.
//
// Two properties the callers depend on:
//
//   **Once.** The promise is kept, not the module, so ten clicks on Generate
//   make one request. A rejected promise is *not* kept — a load that failed
//   because the network blinked should be retryable by clicking again, which
//   is what somebody will do anyway.
//
//   **Ordinary.** It hands back exactly what `import()` hands back — the
//   module namespace — so a call site reads `const { buildSchool } = await
//   generate();` and nothing else about it changes.

export function lazy(load) {
  let pending = null;
  return () => {
    if (pending) return pending;
    // Called straight away rather than off a microtask, so that the request is
    // in flight the instant the first caller asks — and so `pending` is set
    // before any second caller can look at it.
    try {
      pending = Promise.resolve(load());
    } catch (err) {
      return Promise.reject(err);      // a bad specifier is not worth caching
    }
    pending = pending.catch((err) => {
      pending = null;                  // a failed load is worth trying again
      throw err;
    });
    return pending;
  };
}
