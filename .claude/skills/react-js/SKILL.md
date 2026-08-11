---
name: react-optimise-skill
description: >
  Optimise React components for performance, correctness, and maintainability. Use this skill
  whenever the user asks to optimise, refactor, review, debug, or reduce bugs in a React component
  or file. Also trigger when the user mentions slow renders, unnecessary re-renders, stale closures,
  memory leaks, prop drilling issues, broken hooks, or wants a "code review" of React code.
  Even if the user just pastes a component and says "improve this" or "fix this", use this skill.
---

# React Optimisation Skill

A systematic guide for analysing, fixing bugs in, and optimising React components.


## Step 0 — Read Before Touching Code

Before making any changes, read the entire component top-to-bottom and build a mental model:

1. What does this component **render**?
2. What **state** does it hold, and what **props** does it receive?
3. What **side effects** run, and when?
4. What **expensive operations** happen on every render?

Only then proceed. Skipping this step leads to whack-a-mole fixes.



## Step 1 — Bug Audit (Correctness First)

Fix bugs before optimising. A fast buggy component is still broken.

### 1a. Hook Rule Violations
- Hooks must be called at the **top level** — never inside `if`, loops, or nested functions.
- Hooks must only be called from React function components or custom hooks.

```jsx
// ❌ Bug: conditional hook
if (isLoggedIn) {
  const [data, setData] = useState(null); // violates Rules of Hooks
}

// ✅ Fix: always call, conditionally use
const [data, setData] = useState(null);
if (!isLoggedIn) return null;
```

### 1b. Stale Closures in useEffect / useCallback
Think of a closure like a **photograph** — it captures the value at the moment it was taken. If state changes after the photo was taken, the closure still sees the old value.

```jsx
// ❌ Bug: stale closure — count is always 0 inside the effect
useEffect(() => {
  const id = setInterval(() => console.log(count), 1000);
  return () => clearInterval(id);
}, []); // missing dependency

// ✅ Fix: add count to deps, or use functional update
useEffect(() => {
  const id = setInterval(() => console.log(count), 1000);
  return () => clearInterval(id);
}, [count]);
```

**Rule of thumb**: if you read a prop or state value inside `useEffect`/`useCallback`/`useMemo`, it almost certainly belongs in the dependency array.

### 1c. Missing Cleanup in useEffect
Side effects are like restaurant tabs — you must close them when you leave, or they keep running up costs (memory leaks, duplicate subscriptions, state updates on unmounted components).

```jsx
// ❌ Bug: subscription never cancelled
useEffect(() => {
  const sub = eventBus.subscribe(handler);
}, []);

// ✅ Fix: return cleanup function
useEffect(() => {
  const sub = eventBus.subscribe(handler);
  return () => sub.unsubscribe();
}, []);
```

Common things needing cleanup: `setInterval`, `setTimeout`, event listeners, WebSocket connections, Promises (use `AbortController`), subscriptions.

### 1d. Object/Array Identity Bugs
In JavaScript, `{} !== {}` — two objects with the same shape are not equal. This matters because React uses reference equality for dependency arrays and `React.memo`.

```jsx
// ❌ Bug: new object created every render → infinite loop
useEffect(() => {
  fetchData(options);
}, [options]); // options = { page: 1 } defined inside component body

// ✅ Fix: memoize or move outside component
const options = useMemo(() => ({ page: 1 }), []);
```

### 1e. Async State Updates After Unmount
```jsx
// ❌ Can cause "Can't perform a React state update on an unmounted component"
useEffect(() => {
  fetchUser(id).then(user => setUser(user)); // no guard
}, [id]);

// ✅ Fix: use cleanup flag or AbortController
useEffect(() => {
  let cancelled = false;
  fetchUser(id).then(user => {
    if (!cancelled) setUser(user);
  });
  return () => { cancelled = true; };
}, [id]);
```

### 1f. Key Prop Issues in Lists
Keys are like **name tags at a conference** — React uses them to tell participants apart. Missing or unstable keys cause incorrect reconciliation.

```jsx
// ❌ Using index as key when list can reorder/filter
items.map((item, i) => <Item key={i} {...item} />)

// ✅ Use stable unique ID
items.map(item => <Item key={item.id} {...item} />)
```

## Step 2 — Performance Optimisation

Only optimise after bugs are fixed. Premature optimisation adds complexity without solving real problems.

### 2a. Identify Unnecessary Re-renders
A re-render is like a full page reload — sometimes necessary, often avoidable. Ask: *does this component need to update when its parent re-renders?*

**Wrap expensive pure components in `React.memo`:**
```jsx
// Before: re-renders on every parent render
const UserCard = ({ user }) => <div>{user.name}</div>;

// After: only re-renders when `user` reference changes
const UserCard = React.memo(({ user }) => <div>{user.name}</div>);
```

**Note**: `React.memo` only helps if the props are stable. Pair with `useCallback`/`useMemo` for function/object props.

### 2b. Stabilise Functions with useCallback
Functions defined in the component body are recreated on every render. If passed as props to memoized children or used in effect deps, they cause unnecessary re-renders.

```jsx
// ❌ New function reference every render
const handleClick = () => doSomething(id);

// ✅ Stable reference
const handleClick = useCallback(() => doSomething(id), [id]);
```

**Analogy**: `useCallback` is like a cached phone number — same number every time, unless the contact changes.

**When NOT to use `useCallback`**: simple components that aren't memoized, or callbacks that don't flow into children/effects. Over-memoizing adds overhead.

### 2c. Cache Expensive Calculations with useMemo
```jsx
// ❌ Recalculates on every render
const sortedItems = items.sort((a, b) => a.price - b.price);

// ✅ Only recalculates when items changes
const sortedItems = useMemo(
  () => [...items].sort((a, b) => a.price - b.price),
  [items]
);
```

Use `useMemo` when: the calculation is measurably slow (>1ms), or the result is passed to a memoized child. Avoid for simple operations like string concatenation.

### 2d. Code Splitting with React.lazy
Large components loaded upfront slow down initial paint. Lazy loading is like a restaurant serving dishes only when ordered, not all at once.

```jsx
// ❌ Always bundled, even if rarely visited
import HeavyDashboard from './HeavyDashboard';

// ✅ Loaded on demand
const HeavyDashboard = React.lazy(() => import('./HeavyDashboard'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyDashboard />
    </Suspense>
  );
}
```

### 2e. Avoid Expensive Work in Render
```jsx
// ❌ Inline object creation (new ref every render, breaks memo)
<Button style={{ color: 'red' }} onClick={() => handleClick(id)} />

// ✅ Move outside or memoize
const buttonStyle = { color: 'red' }; // outside component if static
const handleClick = useCallback(() => handleClick(id), [id]);
<Button style={buttonStyle} onClick={handleClick} />
```

### 2f. State Colocation
State lifted too high causes wide re-renders. Push state as close to where it's used as possible.

```jsx
// ❌ Global state for local UI concern causes whole tree to re-render
const [isDropdownOpen, setDropdownOpen] = useGlobalStore(s => s.dropdown);

// ✅ Keep it local
function Dropdown() {
  const [isOpen, setOpen] = useState(false);
  ...
}
```

### 2g. Virtualize Long Lists
Rendering 1,000+ DOM nodes is like printing every page of a book just to read one. Use `react-window` or `react-virtual` to render only visible rows.

```jsx
import { FixedSizeList } from 'react-window';

<FixedSizeList height={400} itemCount={items.length} itemSize={50} width="100%">
  {({ index, style }) => <Row style={style} item={items[index]} />}
</FixedSizeList>
```

## Step 3 — Code Quality & Maintainability

### 3a. Custom Hooks for Reusable Logic
Extract repeated stateful logic into custom hooks.

```jsx
// ❌ Fetch logic duplicated across components
const [data, setData] = useState(null);
useEffect(() => { fetch(url).then(...) }, [url]);

// ✅ Reusable custom hook
function useFetch(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);
  return { data, loading, error };
}
```

### 3b. Prop Drilling → Context or Composition
If a prop is passed through 3+ levels just to reach a deep child, consider React Context or component composition.

### 3c. Derived State Anti-Pattern
Don't mirror props in state — it creates two sources of truth that can diverge.

```jsx
// ❌ Derived state
const [fullName, setFullName] = useState(`${firstName} ${lastName}`);

// ✅ Compute during render (or useMemo if expensive)
const fullName = `${firstName} ${lastName}`;
```


## Step 4 — Output Format

When returning optimised code:

1. **Show a brief audit summary** — list bugs found and performance issues identified.
2. **Provide the full optimised component** — not just the changed lines, so it's immediately usable.
3. **Add inline comments** for non-obvious changes explaining *why*, not just *what*.
4. **Call out trade-offs** — e.g., "Added `React.memo` here; only beneficial if parent re-renders frequently."

### Template:
```
## Audit Summary
- 🐛 Bug: [description] → Fixed by [approach]
- ⚡ Performance: [issue] → Fixed by [approach]
- 🧹 Quality: [issue] → Fixed by [approach]

## Optimised Component
[full component code with inline comments]

## Notes & Trade-offs
[any caveats or follow-up recommendations]
```

## Quick Reference Checklist

Before finalising, run through:

- [ ] No hook rule violations (conditional/nested hooks)
- [ ] All `useEffect` deps arrays are complete and correct
- [ ] All `useEffect` side effects have cleanup if needed
- [ ] No object/array literals created inline when passed to memoized components or dep arrays
- [ ] Async effects guard against state updates after unmount
- [ ] List items have stable, unique keys
- [ ] Expensive calculations wrapped in `useMemo`
- [ ] Stable function callbacks use `useCallback` where it matters
- [ ] No derived state (props mirrored into state)
- [ ] Long lists (>100 items) use virtualisation
- [ ] Large lazy-loadable components use `React.lazy`