// The Database page's Back history: where you were before following a key. Newest last.
const MAX = 50

export function pushNav(stack, entry) {
  return [...stack, entry].slice(-MAX)
}

export function popNav(stack) {
  if (!stack.length) return [null, []]
  return [stack[stack.length - 1], stack.slice(0, -1)]
}
