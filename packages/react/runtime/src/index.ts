import { signal, computed, effect, Signal } from "@preact/signals-core";
import { useRef, useMemo, useEffect } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim/index.js";

export { installAutoSignalTracking } from "./auto";

const Empty = [] as const;
const ReactElemType = Symbol.for("react.element"); // https://github.com/facebook/react/blob/346c7d4c43a0717302d446da9e7423a8e28d8996/packages/shared/ReactSymbols.js#L15

export function wrapJsx<T>(jsx: T): T {
	if (typeof jsx !== "function") return jsx;

	return function (type: any, props: any, ...rest: any[]) {
		if (typeof type === "string" && props) {
			for (let i in props) {
				let v = props[i];
				if (i !== "children" && v instanceof Signal) {
					props[i] = v.value;
				}
			}
		}

		return jsx.call(jsx, type, props, ...rest);
	} as any as T;
}

const symDispose: unique symbol =
	(Symbol as any).dispose || Symbol.for("Symbol.dispose");

interface Effect {
	_sources: object | undefined;
	_start(): () => void;
	_callback(): void;
	_dispose(): void;
}

/**
 * Use this flag to represent a bare `useSignals` call that doesn't manually
 * close its effect store and relies on auto-closing when the next useSignals is
 * called or after a microtask
 */
const UNMANAGED = 0;
/**
 * Use this flag to represent a `useSignals` call that is manually closed by a
 * try/finally block in a component's render method. This is the default usage
 * that the react-transform plugin uses.
 */
const MANAGED_COMPONENT = 1;
/**
 * Use this flag to represent a `useSignals` call that is manually closed by a
 * try/finally block in a hook body. This is the default usage that the
 * react-transform plugin uses.
 */
const MANAGED_HOOK = 2;

/**
 * An enum defining how this store is used. See the documentation for each enum
 * member for more details.
 * @see {@link UNMANAGED}
 * @see {@link MANAGED_COMPONENT}
 * @see {@link MANAGED_HOOK}
 */
type EffectStoreUsage =
	| typeof UNMANAGED
	| typeof MANAGED_COMPONENT
	| typeof MANAGED_HOOK;

export interface EffectStore {
	/**
	 * An enum defining how this hook is used and whether it is invoked in a
	 * component's body or hook body. See the comment on `EffectStoreUsage` for
	 * more details.
	 */
	readonly _usage: EffectStoreUsage;
	readonly effect: Effect;
	subscribe(onStoreChange: () => void): () => void;
	getSnapshot(): number;
	/** startEffect - begin tracking signals used in this component */
	_start(): void;
	/** finishEffect - stop tracking the signals used in this component */
	f(): void;
	[symDispose](): void;
}

let currentStore: EffectStore | undefined;

/**
 * A redux-like store whose store value is a positive 32bit integer (a
 * 'version').
 *
 * React subscribes to this store and gets a snapshot of the current 'version',
 * whenever the 'version' changes, we tell React it's time to update the
 * component (call 'onStoreChange').
 *
 * How we achieve this is by creating a binding with an 'effect', when the
 * `effect._callback' is called, we update our store version and tell React to
 * re-render the component ([1] We don't really care when/how React does it).
 *
 * [1]
 * @see https://react.dev/reference/react/useSyncExternalStore
 * @see
 * https://github.com/reactjs/rfcs/blob/main/text/0214-use-sync-external-store.md
 *
 * @param _usage An enum defining how this hook is used and whether it is
 * invoked in a component's body or hook body. See the comment on
 * `EffectStoreUsage` for more details.
 */
function createEffectStore(_usage: EffectStoreUsage): EffectStore {
	let effectInstance!: Effect;
	let version = 0;
	let onChangeNotifyReact: (() => void) | undefined;

	let doRestore = false;
	let prevStore: EffectStore | undefined;
	let endEffect: (() => void) | undefined;

	let unsubscribe = effect(function (this: Effect) {
		effectInstance = this;
	});
	effectInstance._callback = function () {
		version = (version + 1) | 0;
		if (onChangeNotifyReact) onChangeNotifyReact();
	};

	return {
		_usage,
		effect: effectInstance,
		subscribe(onStoreChange) {
			onChangeNotifyReact = onStoreChange;

			return function () {
				/**
				 * Rotate to next version when unsubscribing to ensure that components are re-run
				 * when subscribing again.
				 *
				 * In StrictMode, 'memo'-ed components seem to keep a stale snapshot version, so
				 * don't re-run after subscribing again if the version is the same as last time.
				 *
				 * Because we unsubscribe from the effect, the version may not change. We simply
				 * set a new initial version in case of stale snapshots here.
				 */
				version = (version + 1) | 0;
				onChangeNotifyReact = undefined;
				unsubscribe();
			};
		},
		getSnapshot() {
			return version;
		},
		_start() {
			// TODO: implement state machine to transition between effect stores:
			//
			// - 0 -> 0: finish previous effect (unknown to unknown)
			//
			// - 0 -> 1: finish previous effect
			//   Assume previous invocation was another component or hook from another
			//   component. Nested component renders (renderToStaticMarkup) not
			//   supported with bare useSignals calls.
			//
			//   TODO: this breaks the workaround for render props that contain signals.
			//   If a component renders a managed child, then a component with a render
			//   prop, the signal in the render prop won't be tracked by the parents
			//   useSignals call.
			//
			// - 0 -> 2: capture & restore
			//   Previous invocation could be a component or a hook. Either way,
			//   restore it after our invocation so that it can continue to capture
			//   any signals after we exit.
			//
			// - 1 -> 0: ? do nothing since it'll be captured by current effect store?
			// - 1 -> 1: capture & restore (e.g. component calls renderToStaticMarkup)
			// - 1 -> 2: capture & restore (e.g. hook)
			//
			// - 2 -> 0: ? do nothing since it'll be captured by current effect store?
			// - 2 -> 1: capture & restore (e.g. hook calls renderToStaticMarkup)
			// - 2 -> 2: capture & restore (e.g. nested hook calls)

			// ------------------------------

			// currentStore?.f();
			// endEffect = effectInstance._start();
			// currentStore = this;

			// ------------------------------

			if (currentStore == undefined) {
				doRestore = true;
				prevStore = undefined;

				// first effect store
				endEffect = effectInstance._start();
				currentStore = this;

				return;
			}

			const prevUsage = currentStore._usage;
			const thisUsage = this._usage;

			if (
				(prevUsage == UNMANAGED && thisUsage == UNMANAGED) || // 0 -> 0
				(prevUsage == UNMANAGED && thisUsage == MANAGED_COMPONENT) // 0 -> 1
			) {
				// finish previous effect (unknown to unknown)
				currentStore.f();

				doRestore = true;
				prevStore = undefined;

				endEffect = effectInstance._start();
				currentStore = this;
			} else if (
				(prevUsage == MANAGED_COMPONENT && thisUsage == UNMANAGED) || // 1 -> 0
				(prevUsage == MANAGED_HOOK && thisUsage == UNMANAGED) // 2 -> 0
			) {
				// Do nothing since it'll be captured by current effect store
			} else {
				// nested scenarios, so capture and restore the previous effect store
				doRestore = true;
				prevStore = currentStore;

				endEffect = effectInstance._start();
				currentStore = this;
			}
		},
		f() {
			endEffect?.();
			if (doRestore) {
				currentStore = prevStore;
			}

			prevStore = undefined;
			endEffect = undefined;
			doRestore = false;
		},
		[symDispose]() {
			this.f();
		},
	};
}

const _queueMicroTask = Promise.prototype.then.bind(Promise.resolve());

let finalCleanup: Promise<void> | undefined;
function ensureFinalCleanup() {
	if (!finalCleanup) {
		finalCleanup = _queueMicroTask(() => {
			finalCleanup = undefined;
			currentStore?.f();
		});
	}
}

/**
 * Custom hook to create the effect to track signals used during render and
 * subscribe to changes to rerender the component when the signals change.
 */
export function useSignals(_usage: EffectStoreUsage = UNMANAGED): EffectStore {
	ensureFinalCleanup();

	const storeRef = useRef<EffectStore>();
	if (storeRef.current == null) {
		storeRef.current = createEffectStore(_usage);
	}

	const store = storeRef.current;
	useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	store._start();

	return store;
}

/**
 * A wrapper component that renders a Signal's value directly as a Text node or JSX.
 */
function SignalValue({ data }: { data: Signal }) {
	const store = useSignals();
	try {
		return data.value;
	} finally {
		store.f();
	}
}

// Decorate Signals so React renders them as <SignalValue> components.
Object.defineProperties(Signal.prototype, {
	$$typeof: { configurable: true, value: ReactElemType },
	type: { configurable: true, value: SignalValue },
	props: {
		configurable: true,
		get() {
			return { data: this };
		},
	},
	ref: { configurable: true, value: null },
});

export function useSignal<T>(value: T) {
	return useMemo(() => signal<T>(value), Empty);
}

export function useComputed<T>(compute: () => T) {
	const $compute = useRef(compute);
	$compute.current = compute;
	return useMemo(() => computed<T>(() => $compute.current()), Empty);
}

export function useSignalEffect(cb: () => void | (() => void)) {
	const callback = useRef(cb);
	callback.current = cb;

	useEffect(() => {
		return effect(() => callback.current());
	}, Empty);
}
