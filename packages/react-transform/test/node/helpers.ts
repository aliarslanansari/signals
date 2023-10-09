/* eslint no-console: 0 */

interface InputOutput {
	input: string;
	transformed: string;
}

export type CommentKind = "opt-in" | "opt-out" | undefined;
type VariableKind = "var" | "let" | "const";
type ParamsConfig = 0 | 1 | 2 | 3 | undefined;

interface FuncDeclComponent {
	type: "FuncDeclComp";
	name?: string;
	body: string;
	params?: ParamsConfig;
	comment?: CommentKind;
}

interface FuncExpComponent {
	type: "FuncExpComp";
	name?: string;
	body: string;
	params?: ParamsConfig;
}

interface ArrowFuncComponent {
	type: "ArrowComp";
	return: "statement" | "expression";
	body: string;
	params?: ParamsConfig;
}

interface CallExp {
	type: "CallExp";
	name: string;
	args: Array<InputOutput>;
}

interface Variable {
	type: "Variable";
	name: string;
	body: InputOutput;
	kind?: VariableKind;
	comment?: CommentKind;
}

interface Assignment {
	type: "Assignment";
	name: string;
	body: InputOutput;
	kind?: VariableKind;
	comment?: CommentKind;
}

interface ObjectProperty {
	type: "ObjectProperty";
	name: string;
	body: InputOutput;
	comment?: CommentKind;
}

interface ExportDefault {
	type: "ExportDefault";
	body: InputOutput;
	comment?: CommentKind;
}

interface ExportNamed {
	type: "ExportNamed";
	body: InputOutput;
	comment?: CommentKind;
}

// TODO: add object method & member expression assignments? Note object prop and
// obj method can have computed keys of arbitrary expressions. Probably can't
// handle those automatically. Would need a comment to opt-in.
type Node =
	| FuncDeclComponent
	| FuncExpComponent
	| ArrowFuncComponent
	| CallExp
	| Variable
	| Assignment
	| ObjectProperty
	| ExportDefault
	| ExportNamed;

interface NodeTypes {
	FuncDeclComp: FuncDeclComponent;
	FuncExpComp: FuncExpComponent;
	ArrowComp: ArrowFuncComponent;
	CallExp: CallExp;
	ExportDefault: ExportDefault;
	ExportNamed: ExportNamed;
	Variable: Variable;
	Assignment: Assignment;
	ObjectProperty: ObjectProperty;
}

type Generators = {
	[key in keyof NodeTypes]: (config: NodeTypes[key]) => InputOutput;
};

function applyTransform(body: string, addReturn = false): string {
	return `var _effect = _useSignals();
	try {
		${addReturn ? "return " : ""}${body}
	} finally {
		_effect.f();
	}`;
}

function generateParams(count?: ParamsConfig): string {
	if (count == null || count === 0) return "";
	if (count === 1) return "props";
	if (count === 2) return "props, ref";
	return Array.from({ length: count }, (_, i) => `arg${i}`).join(", ");
}

function generateComment(comment?: CommentKind): string {
	if (comment === "opt-out") return "// @noTrackSignals\n";
	if (comment === "opt-in") return "// @trackSignals\n";
	return "";
}

const codeGenerators: Generators = {
	FuncDeclComp(config) {
		const params = generateParams(config.params);
		const inputBody = config.body;
		const outputBody = applyTransform(config.body);
		let comment = generateComment(config.comment);
		return {
			input: `${comment}function ${config.name}(${params}) {\n${inputBody}\n}`,
			transformed: `${comment}function ${config.name}(${params}) {\n${outputBody}\n}`,
		};
	},
	FuncExpComp(config) {
		const name = config.name ?? "";
		const params = generateParams(config.params);
		const inputBody = config.body;
		const outputBody = applyTransform(config.body);
		return {
			input: `(function ${name}(${params}) {\n${inputBody}\n})`,
			transformed: `(function ${name}(${params}) {\n${outputBody}\n})`,
		};
	},
	ArrowComp(config) {
		const params = generateParams(config.params);
		const isExpBody = config.return === "expression";
		const inputBody = isExpBody ? config.body : `{\n${config.body}\n}`;
		const outputBody = applyTransform(config.body, isExpBody);
		return {
			input: `(${params}) => ${inputBody}`,
			transformed: `(${params}) => {\n${outputBody}\n}`,
		};
	},
	CallExp(config) {
		return {
			input: `${config.name}(${config.args.map(arg => arg.input).join(", ")})`,
			transformed: `${config.name}(${config.args
				.map(arg => arg.transformed)
				.join(", ")})`,
		};
	},
	Variable(config) {
		const kind = config.kind ?? "const";
		const comment = generateComment(config.comment);
		return {
			input: `${comment}${kind} ${config.name} = ${config.body.input}`,
			transformed: `${comment}${kind} ${config.name} = ${config.body.transformed}`,
		};
	},
	Assignment(config) {
		const kind = config.kind ?? "let";
		const comment = generateComment(config.comment);
		return {
			input: `${kind} ${config.name};\n ${comment}${config.name} = ${config.body.input}`,
			transformed: `${kind} ${config.name};\n ${comment}${config.name} = ${config.body.transformed}`,
		};
	},
	ObjectProperty(config) {
		const comment = generateComment(config.comment);
		return {
			input: `{\n ${comment}${config.name}: ${config.body.input} \n}`,
			transformed: `{\n ${comment}${config.name}: ${config.body.transformed} \n}`,
		};
	},
	ExportDefault(config) {
		const comment = generateComment(config.comment);
		return {
			input: `${comment}export default ${config.body.input}`,
			transformed: `${comment}export default ${config.body.transformed}`,
		};
	},
	ExportNamed(config) {
		const comment = generateComment(config.comment);
		return {
			input: `${comment}export ${config.body.input}`,
			transformed: `${comment}export ${config.body.transformed}`,
		};
	},
};

function generateCode(config: Node): InputOutput {
	return codeGenerators[config.type](config as any);
}

export interface TestCase extends InputOutput {
	name: string;
}

interface TestCaseConfig {
	/** Whether to output source code that auto should transform  */
	auto: boolean;
	/** What kind of opt-in or opt-out to include if any */
	comment?: CommentKind;
	/** Test case name for including in `it` */
	name?: string;
	/** Number of parameters the component function should have */
	params?: ParamsConfig;
}

const testName = (...parts: Array<string | undefined>) =>
	parts.filter(Boolean).join(" ");

function expressionComponents(config: TestCaseConfig): TestCase[] {
	const { name: baseName, params } = config;
	if (config.auto) {
		return [
			{
				name: testName(baseName, "as function without inline name"),
				...generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: testName(baseName, "as function with proper inline name"),
				...generateCode({
					type: "FuncExpComp",
					name: "App",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: testName(baseName, "as arrow function with statement body"),
				...generateCode({
					type: "ArrowComp",
					return: "statement",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: testName(baseName, "as arrow function with expression body"),
				...generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "<div>{signal.value}</div>",
					params,
				}),
			},
		];
	} else {
		return [
			{
				name: testName(baseName, "as function with bad inline name"),
				...generateCode({
					type: "FuncExpComp",
					name: "app",
					body: "return signal.value",
					params,
				}),
			},
			{
				name: testName(baseName, "as function with no JSX"),
				...generateCode({
					type: "FuncExpComp",
					body: "return signal.value",
					params,
				}),
			},
			{
				name: testName(baseName, "as function with no signals"),
				...generateCode({
					type: "FuncExpComp",
					body: "return <div>Hello World</div>",
					params,
				}),
			},
			{
				name: testName(baseName, "as arrow function with no JSX"),
				...generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "signal.value",
					params,
				}),
			},
			{
				name: testName(baseName, "as arrow function with no signals"),
				...generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "<div>Hello World</div>",
					params,
				}),
			},
		];
	}
}

function withCallExpWrappers(config: TestCaseConfig): TestCase[] {
	const testCases: TestCase[] = [];

	// Simulate a component wrapped memo
	const memoedComponents = expressionComponents({ ...config, params: 1 });
	for (let component of memoedComponents) {
		testCases.push({
			name: component.name + " wrapped in memo",
			...generateCode({
				type: "CallExp",
				name: "memo",
				args: [component],
			}),
		});
	}

	// Simulate a component wrapped in forwardRef
	const forwardRefComponents = expressionComponents({ ...config, params: 2 });
	for (let component of forwardRefComponents) {
		testCases.push({
			name: component.name + " wrapped in forwardRef",
			...generateCode({
				type: "CallExp",
				name: "forwardRef",
				args: [component],
			}),
		});
	}

	//Simulate components wrapped in both memo and forwardRef
	for (let component of forwardRefComponents) {
		testCases.push({
			name: component.name + " wrapped in memo and forwardRef",
			...generateCode({
				type: "CallExp",
				name: "memo",
				args: [
					generateCode({
						type: "CallExp",
						name: "forwardRef",
						args: [component],
					}),
				],
			}),
		});
	}

	return testCases;
}

export function declarationComp(config: TestCaseConfig): TestCase[] {
	const { name: baseName, params, comment } = config;
	if (config.auto) {
		return [
			{
				name: testName(baseName, "with proper name, jsx, and signal usage"),
				...generateCode({
					type: "FuncDeclComp",
					name: "App",
					body: "return <>{signal.value}</>",
					params,
					comment,
				}),
			},
		];
	} else {
		return [
			{
				name: testName(baseName, "with bad name"),
				...generateCode({
					type: "FuncDeclComp",
					name: "app",
					body: "return <div>{signal.value}</div>",
					params,
					comment,
				}),
			},
			{
				name: testName(baseName, "with no JSX"),
				...generateCode({
					type: "FuncDeclComp",
					name: "App",
					body: "return signal.value",
					params,
					comment,
				}),
			},
			{
				name: testName(baseName, "with no signals"),
				...generateCode({
					type: "FuncDeclComp",
					name: "App",
					body: "return <div>Hello World</div>",
					params,
					comment,
				}),
			},
		];
	}
}

export function variableComp(config: TestCaseConfig): TestCase[] {
	const { name: baseName, comment } = config;
	const testCases: TestCase[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		testCases.push({
			name: testName(c.name),
			...generateCode({
				type: "Variable",
				name: "VarComp",
				body: c,
				comment,
			}),
		});
	}

	if (!config.auto) {
		testCases.push({
			name: testName(baseName, `as function with bad variable name`),
			...generateCode({
				type: "Variable",
				name: "render",
				comment,
				body: generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
				}),
			}),
		});

		testCases.push({
			name: testName(baseName, `as arrow function with bad variable name`),
			...generateCode({
				type: "Variable",
				name: "render",
				comment,
				body: generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "<div>{signal.value}</div>",
				}),
			}),
		});
	}

	// With HoC wrappers, we are testing the logic to find the component name. So
	// only generate tests where the function body is correct ("auto" is true) and
	// the name is either correct or bad.
	const hocComponents = withCallExpWrappers({
		...config,
		auto: true,
	});
	const suffix = config.auto ? "" : "with bad variable name";
	for (const c of hocComponents) {
		testCases.push({
			name: testName(c.name, suffix),
			...generateCode({
				type: "Variable",
				name: config.auto ? "VarComp" : "render",
				body: c,
				comment,
			}),
		});
	}

	return testCases;
}

export function assignmentComp(config: TestCaseConfig): TestCase[] {
	const { name: baseName, comment } = config;
	const testCases: TestCase[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		testCases.push({
			name: testName(c.name),
			...generateCode({
				type: "Assignment",
				name: "AssignComp",
				body: c,
				comment,
			}),
		});
	}

	if (!config.auto) {
		testCases.push({
			name: testName(baseName, "function component with bad variable name"),
			...generateCode({
				type: "Assignment",
				name: "render",
				comment,
				body: generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
				}),
			}),
		});

		testCases.push({
			name: testName(baseName, "arrow function with bad variable name"),
			...generateCode({
				type: "Assignment",
				name: "render",
				comment,
				body: generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "<div>{signal.value}</div>",
				}),
			}),
		});
	}

	// With HoC wrappers, we are testing the logic to find the component name. So
	// only generate tests where the function body is correct ("auto" is true) and
	// the name is either correct or bad.
	const hocComponents = withCallExpWrappers({
		...config,
		auto: true,
	});
	const suffix = config.auto ? "" : "with bad variable name";
	for (const c of hocComponents) {
		testCases.push({
			name: testName(c.name, suffix),
			...generateCode({
				type: "Assignment",
				name: config.auto ? "AssignComp" : "render",
				body: c,
				comment,
			}),
		});
	}

	return testCases;
}

export function objectPropertyComp(config: TestCaseConfig): TestCase[] {
	const { name: baseName, comment } = config;
	const testCases: TestCase[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		testCases.push({
			name: c.name,
			...generateCode({
				type: "ObjectProperty",
				name: "ObjComp",
				body: c,
				comment,
			}),
		});
	}

	if (!config.auto) {
		testCases.push({
			name: testName(baseName, "function component with bad property name"),
			...generateCode({
				type: "ObjectProperty",
				name: "render_prop",
				comment,
				body: generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
				}),
			}),
		});

		testCases.push({
			name: testName(baseName, "arrow function with bad property name"),
			...generateCode({
				type: "ObjectProperty",
				name: "render_prop",
				comment,
				body: generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "<div>{signal.value}</div>",
				}),
			}),
		});
	}

	// With HoC wrappers, we are testing the logic to find the component name. So
	// only generate tests where the function body is correct ("auto" is true) and
	// the name is either correct or bad.
	const hocComponents = withCallExpWrappers({
		...config,
		auto: true,
	});
	const suffix = config.auto ? "" : "with bad property name";
	for (const c of hocComponents) {
		testCases.push({
			name: testName(c.name, suffix),
			...generateCode({
				type: "ObjectProperty",
				name: config.auto ? "ObjComp" : "render_prop",
				body: c,
				comment,
			}),
		});
	}

	return testCases;
}

export function exportDefaultComp(config: TestCaseConfig): TestCase[] {
	const { comment } = config;
	const testCases: TestCase[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		testCases.push({
			name: c.name + " exported as default",
			...generateCode({
				type: "ExportDefault",
				body: c,
				comment,
			}),
		});
	}

	const hocComponents = withCallExpWrappers(config);
	for (const c of hocComponents) {
		testCases.push({
			name: c.name + " exported as default",
			...generateCode({
				type: "ExportDefault",
				body: c,
				comment,
			}),
		});
	}

	return testCases;
}

export function exportNamedComp(config: TestCaseConfig): TestCase[] {
	const { comment } = config;
	const testCases: TestCase[] = [];

	// `declarationComp` will put the comment on the function declaration, but in
	// this case we want to put it on the export statement.
	const funcComponents = declarationComp({ ...config, comment: undefined });
	for (const c of funcComponents) {
		testCases.push({
			name: `function declaration ${c.name}`,
			...generateCode({
				type: "ExportNamed",
				body: c,
				comment,
			}),
		});
	}

	// `variableComp` will put the comment on the function declaration, but in
	// this case we want to put it on the export statement.
	const varComponents = variableComp({ ...config, comment: undefined });
	for (const c of varComponents) {
		const name = c.name.replace(" variable ", " exported ");
		testCases.push({
			name: `variable ${name}`,
			...generateCode({
				type: "ExportNamed",
				body: c,
				comment,
			}),
		});
	}

	return testCases;
}

// Command to use to debug the generated code
// ../../../../node_modules/.bin/tsc --target es2020 --module es2020 --moduleResolution node --esModuleInterop --outDir . helpers.ts; mv helpers.js helpers.mjs; node helpers.mjs
async function debug() {
	// @ts-ignore
	const prettier = await import("prettier");
	const format = (code: string) => prettier.format(code, { parser: "babel" });
	console.log("generating...");
	console.time("generated");
	const testCases: TestCase[] = [
		// ...declarationComponents({ name: "transforms a", auto: true }),
		// ...declarationComponents({ name: "does not transform a", auto: false }),
		//
		// ...expressionComponents({ name: "transforms a", auto: true }),
		// ...expressionComponents({ name: "does not transform a", auto: false }),
		//
		// ...withCallExpWrappers({ name: "transforms a", auto: true }),
		// ...withCallExpWrappers({ name: "does not transform a", auto: false }),
		//
		...variableComp({ name: "transforms a", auto: true }),
		...variableComp({ name: "does not transform a", auto: false }),

		...assignmentComp({ name: "transforms a", auto: true }),
		...assignmentComp({ name: "does not transform a", auto: false }),

		...objectPropertyComp({ name: "transforms a", auto: true }),
		...objectPropertyComp({ name: "does not transform a", auto: false }),

		...exportDefaultComp({ name: "transforms a", auto: true }),
		...exportDefaultComp({ name: "does not transform a", auto: false }),

		...exportNamedComp({ name: "transforms a", auto: true }),
		...exportNamedComp({ name: "does not transform a", auto: false }),
	];
	console.timeEnd("generated");

	for (const testCase of testCases) {
		console.log("=".repeat(80));
		console.log(testCase.name);
		console.log("input:");
		console.log(await format(testCase.input));
		console.log("transformed:");
		console.log(await format(testCase.transformed));
		console.log();
	}
}

// debug();
