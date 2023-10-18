import * as signalsCore from "@preact/signals-core";
import { batch, signal } from "@preact/signals-core";
import { PluginOptions } from "@preact/signals-react-transform";
import * as signalsRuntime from "@preact/signals-react/runtime";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {
	Root,
	act,
	checkConsoleErrorLogs,
	checkHangingAct,
	createRoot,
	getConsoleErrorSpy,
} from "../../../react/test/shared/utils";

const customSource = "useSignals-custom-source";
const modules: Record<string, any> = {
	"@preact/signals-core": signalsCore,
	"@preact/signals-react/runtime": signalsRuntime,
	"react/jsx-runtime": jsxRuntime,
	[customSource]: signalsRuntime,
};

function testRequire(name: string) {
	if (name in modules) {
		return modules[name];
	} else {
		throw new Error(`Module ${name} not setup in "testRequire".`);
	}
}

async function createComponent(code: string, options?: PluginOptions) {
	// `transformSignalCode` is a global helper function added to the global
	// namespace by a test helper we've included in the Karma config.
	const cjsCode = transformSignalCode(code, options);
	// console.log(cjsCode); // Useful when debugging tests.

	const exports: any = {};
	const wrapper = new Function("exports", "require", cjsCode);
	wrapper(exports, testRequire);
	return exports;
}

describe("React Signals babel transfrom - browser E2E tests", () => {
	let scratch: HTMLDivElement;
	let root: Root;

	async function render(element: Parameters<Root["render"]>[0]) {
		await act(() => root.render(element));
	}

	beforeEach(async () => {
		scratch = document.createElement("div");
		document.body.appendChild(scratch);
		root = await createRoot(scratch);
		getConsoleErrorSpy().resetHistory();
	});

	afterEach(async () => {
		await act(() => root.unmount());
		scratch.remove();

		checkConsoleErrorLogs();
		checkHangingAct();
	});

	it("should rerender components when using signals as text", async () => {
		const { App } = await createComponent(`
			export function App({ name }) {
				return <div>Hello {name}</div>;
			}`);

		const name = signal("John");
		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hello Jane</div>");
	});

	it("should rerender components when signals they use change", async () => {
		const { App } = await createComponent(`
			export function App({ name }) {
				return <div>Hello {name.value}</div>;
			}`);

		const name = signal("John");
		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hello Jane</div>");
	});

	it("should rerender components with custom hooks that use signals", async () => {
		const { App, name } = await createComponent(`
			import { signal } from "@preact/signals-core";

			export const name = signal("John");
			function useName() {
				return name.value;
			}

			export function App() {
				const name = useName();
				return <div>Hello {name}</div>;
			}`);

		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hello Jane</div>");
	});

	it("should rerender components with multiple custom hooks that use signals", async () => {
		const { App, name, greeting } = await createComponent(`
			import { signal } from "@preact/signals-core";

			export const greeting = signal("Hello");
			function useGreeting() {
				return greeting.value;
			}

			export const name = signal("John");
			function useName() {
				return name.value;
			}

			export function App() {
				const greeting = useGreeting();
				const name = useName();
				return <div>{greeting} {name}</div>;
			}`);

		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			greeting.value = "Hi";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi Jane</div>");

		await act(() => {
			batch(() => {
				greeting.value = "Hello";
				name.value = "John";
			});
		});
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");
	});

	it("should rerender components that use signals with multiple custom hooks that use signals", async () => {
		const { App, name, greeting, punctuation } = await createComponent(`
			import { signal } from "@preact/signals-core";

			export const greeting = signal("Hello");
			function useGreeting() {
				return greeting.value;
			}

			export const name = signal("John");
			function useName() {
				return name.value;
			}

			export const punctuation = signal("!");
			export function App() {
				const greeting = useGreeting();
				const name = useName();
				return <div>{greeting} {name}{punctuation.value}</div>;
			}`);

		await render(<App />);
		expect(scratch.innerHTML).to.equal("<div>Hello John!</div>");

		await act(() => {
			greeting.value = "Hi";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi John!</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi Jane!</div>");

		await act(() => {
			punctuation.value = "?";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi Jane?</div>");

		await act(() => {
			batch(() => {
				greeting.value = "Hello";
				name.value = "John";
				punctuation.value = "!";
			});
		});
		expect(scratch.innerHTML).to.equal("<div>Hello John!</div>");
	});

	it.skip("should work when an ambiguous function is manually transformed and used as a hook", async () => {
		// TODO: Warn/Error when manually opting in ambiguous function into transform
		// TODO: Update transform to skip try/finally when transforming ambiguous function
		const { App, greeting, name } = await createComponent(`
			import { signal } from "@preact/signals-core";

			export const greeting = signal("Hello");
			export const name = signal("John");

			// Ambiguous if this function is gonna be a hook or component
			/** @trackSignals */
			function usename() {
				return name.value;
			}

			export function App() {
				const name = usename();
				return <div>{greeting.value} {name}</div>;
			}`);

		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			greeting.value = "Hi";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hi Jane</div>");

		await act(() => {
			batch(() => {
				greeting.value = "Hello";
				name.value = "John";
			});
		});
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");
	});

	it("loads useSignals from a custom source", async () => {
		const { App } = await createComponent(
			`
			export function App({ name }) {
				return <div>Hello {name.value}</div>;
			}`,
			{ importSource: customSource }
		);

		const name = signal("John");
		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hello Jane</div>");
	});

	it("works with the `using` keyword", async () => {
		const { App } = await createComponent(
			`
			import { useSignals } from "@preact/signals-react/runtime";

			export function App({ name }) {
				using _ = useSignals();
				return <div>Hello {name.value}</div>;
			}`,
			// Disable our babel plugin for this example so the explicit resource management plugin handles this case
			{ mode: "manual" }
		);

		const name = signal("John");
		await render(<App name={name} />);
		expect(scratch.innerHTML).to.equal("<div>Hello John</div>");

		await act(() => {
			name.value = "Jane";
		});
		expect(scratch.innerHTML).to.equal("<div>Hello Jane</div>");
	});
});
