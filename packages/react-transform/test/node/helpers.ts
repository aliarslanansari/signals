/**
 * This file generates test cases for the transform. It generates a bunch of
 * different components and then generates the source code for them. The
 * generated source code is then used as the input for the transform. The test
 * can then assert whether the transform should transform the code into the
 * expected output or leave it untouched.
 *
 * Many of the language constructs generated here are to test the logic that
 * finds the component name. For example, the transform should be able to find
 * the component name even if the component is wrapped in a memo or forwardRef
 * call. So we generate a bunch of components wrapped in those calls.
 *
 * We also generate constructs to test where users may place the comment to opt
 * in or out of tracking signals. For example, the comment may be placed on the
 * function declaration, the variable declaration, or the export statement.
 *
 * Some common abbreviations you may see in this file:
 * - Comp: component
 * - Exp: expression
 * - Decl: declaration
 * - Var: variable
 * - Obj: object
 * - Prop: property
 */

// TODO: consider separating into a codeGenerators.ts file and a caseGenerators.ts file

/**
 * Interface representing the input and transformed output. A test may choose
 * to use the transformed output or ignore it if the test is asserting the
 * plugin does nothing
 */
interface InputOutput {
	input: string;
	transformed: string;
}

export type CommentKind = "opt-in" | "opt-out" | undefined;
type VariableKind = "var" | "let" | "const";
type ParamsConfig = 0 | 1 | 2 | 3 | undefined;

interface FuncDeclComponent {
	type: "FuncDeclComp";
	name: string;
	body: string;
	params?: ParamsConfig;
	comment?: CommentKind;
}

interface FuncDeclHook {
	type: "FuncDeclHook";
	name: string;
	body: string;
	comment?: CommentKind;
}

interface FuncExpComponent {
	type: "FuncExpComp";
	name?: string;
	body: string;
	params?: ParamsConfig;
}

interface FuncExpHook {
	type: "FuncExpHook";
	name?: string;
	body: string;
}

interface ArrowFuncComponent {
	type: "ArrowComp";
	return: "statement" | "expression";
	body: string;
	params?: ParamsConfig;
}

interface ArrowFuncHook {
	type: "ArrowFuncHook";
	return: "statement" | "expression";
	body: string;
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
	inlineComment?: CommentKind;
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
	| FuncDeclHook
	| FuncExpComponent
	| FuncExpHook
	| ArrowFuncComponent
	| ArrowFuncHook
	| CallExp
	| Variable
	| Assignment
	| ObjectProperty
	| ExportDefault
	| ExportNamed;

interface NodeTypes {
	FuncDeclComp: FuncDeclComponent;
	FuncDeclHook: FuncDeclHook;
	FuncExpComp: FuncExpComponent;
	FuncExpHook: FuncExpHook;
	ArrowComp: ArrowFuncComponent;
	ArrowFuncHook: ArrowFuncHook;
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

function transformComponent(
	config: FuncDeclComponent | FuncExpComponent | ArrowFuncComponent
): string {
	const { type, body } = config;
	const addReturn = type === "ArrowComp" && config.return === "expression";

	return `var _effect = _useSignals();
	try {
		${addReturn ? "return " : ""}${body}
	} finally {
		_effect.f();
	}`;
}

function transformHook(
	config: FuncDeclHook | FuncExpHook | ArrowFuncHook
): string {
	const { type, body } = config;
	const addReturn = type === "ArrowFuncHook" && config.return === "expression";

	return `_useSignals();
	${addReturn ? "return " : ""}${body}`;
}

function generateParams(count?: ParamsConfig): string {
	if (count == null || count === 0) return "";
	if (count === 1) return "props";
	if (count === 2) return "props, ref";
	return Array.from({ length: count }, (_, i) => `arg${i}`).join(", ");
}

function generateComment(comment?: CommentKind): string {
	if (comment === "opt-out") return "/* @noTrackSignals */\n";
	if (comment === "opt-in") return "/* @trackSignals */\n";
	return "";
}

const codeGenerators: Generators = {
	FuncDeclComp(config) {
		const params = generateParams(config.params);
		const inputBody = config.body;
		const outputBody = transformComponent(config);
		let comment = generateComment(config.comment);
		return {
			input: `${comment}function ${config.name}(${params}) {\n${inputBody}\n}`,
			transformed: `${comment}function ${config.name}(${params}) {\n${outputBody}\n}`,
		};
	},
	FuncDeclHook(config) {
		const inputBody = config.body;
		const outputBody = transformHook(config);
		let comment = generateComment(config.comment);
		return {
			input: `${comment}function ${config.name}() {\n${inputBody}\n}`,
			transformed: `${comment}function ${config.name}() {\n${outputBody}\n}`,
		};
	},
	FuncExpComp(config) {
		const name = config.name ?? "";
		const params = generateParams(config.params);
		const inputBody = config.body;
		const outputBody = transformComponent(config);
		return {
			input: `(function ${name}(${params}) {\n${inputBody}\n})`,
			transformed: `(function ${name}(${params}) {\n${outputBody}\n})`,
		};
	},
	FuncExpHook(config) {
		const name = config.name ?? "";
		const inputBody = config.body;
		const outputBody = transformHook(config);
		return {
			input: `(function ${name}() {\n${inputBody}\n})`,
			transformed: `(function ${name}() {\n${outputBody}\n})`,
		};
	},
	ArrowComp(config) {
		const params = generateParams(config.params);
		const isExpBody = config.return === "expression";
		const inputBody = isExpBody ? config.body : `{\n${config.body}\n}`;
		const outputBody = transformComponent(config);
		return {
			input: `(${params}) => ${inputBody}`,
			transformed: `(${params}) => {\n${outputBody}\n}`,
		};
	},
	ArrowFuncHook(config) {
		const isExpBody = config.return === "expression";
		const inputBody = isExpBody ? config.body : `{\n${config.body}\n}`;
		const outputBody = transformHook(config);
		return {
			input: `() => ${inputBody}`,
			transformed: `() => {\n${outputBody}\n}`,
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
		const inlineComment = generateComment(config.inlineComment)?.trim();
		return {
			input: `${comment}${kind} ${config.name} = ${inlineComment}${config.body.input}`,
			transformed: `${comment}${kind} ${config.name} = ${inlineComment}${config.body.transformed}`,
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
			input: `var o = {\n ${comment}${config.name}: ${config.body.input} \n}`,
			transformed: `var o = {\n ${comment}${config.name}: ${config.body.transformed} \n}`,
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

export interface GeneratedCode extends InputOutput {
	name: string;
}

interface CodeConfig {
	/** Whether to output source code that auto should transform  */
	auto: boolean;
	/** What kind of opt-in or opt-out to include if any */
	comment?: CommentKind;
	/** Name of the generated code (useful for test case titles) */
	name?: string;
	/** Number of parameters the component function should have */
	params?: ParamsConfig;
}

interface VariableCodeConfig extends CodeConfig {
	inlineComment?: CommentKind;
}

const codeTitle = (...parts: Array<string | undefined>) =>
	parts.filter(Boolean).join(" ");

function expressionComponents(config: CodeConfig): GeneratedCode[] {
	const { name: baseName, params } = config;
	if (config.auto) {
		return [
			{
				name: codeTitle(baseName, "as function without inline name"),
				...generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as function with proper inline name"),
				...generateCode({
					type: "FuncExpComp",
					name: "App",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as arrow function with statement body"),
				...generateCode({
					type: "ArrowComp",
					return: "statement",
					body: "return <div>{signal.value}</div>",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as arrow function with expression body"),
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
				name: codeTitle(baseName, "as function with bad inline name"),
				...generateCode({
					type: "FuncExpComp",
					name: "app",
					body: "return signal.value",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as function with no JSX"),
				...generateCode({
					type: "FuncExpComp",
					body: "return signal.value",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as function with no signals"),
				...generateCode({
					type: "FuncExpComp",
					body: "return <div>Hello World</div>",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as arrow function with no JSX"),
				...generateCode({
					type: "ArrowComp",
					return: "expression",
					body: "signal.value",
					params,
				}),
			},
			{
				name: codeTitle(baseName, "as arrow function with no signals"),
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

function withCallExpWrappers(config: CodeConfig): GeneratedCode[] {
	const codeCases: GeneratedCode[] = [];

	// Simulate a component wrapped memo
	const memoedComponents = expressionComponents({ ...config, params: 1 });
	for (let component of memoedComponents) {
		codeCases.push({
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
		codeCases.push({
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
		codeCases.push({
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

	return codeCases;
}

export function declarationComp(config: CodeConfig): GeneratedCode[] {
	const { name: baseName, params, comment } = config;
	if (config.auto) {
		return [
			{
				name: codeTitle(baseName, "with proper name, jsx, and signal usage"),
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
				name: codeTitle(baseName, "with bad name"),
				...generateCode({
					type: "FuncDeclComp",
					name: "app",
					body: "return <div>{signal.value}</div>",
					params,
					comment,
				}),
			},
			{
				name: codeTitle(baseName, "with no JSX"),
				...generateCode({
					type: "FuncDeclComp",
					name: "App",
					body: "return signal.value",
					params,
					comment,
				}),
			},
			{
				name: codeTitle(baseName, "with no signals"),
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

export function variableComp(config: VariableCodeConfig): GeneratedCode[] {
	const { name: baseName, comment, inlineComment } = config;
	const codeCases: GeneratedCode[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		codeCases.push({
			name: codeTitle(c.name),
			...generateCode({
				type: "Variable",
				name: "VarComp",
				body: c,
				comment,
				inlineComment,
			}),
		});
	}

	if (!config.auto) {
		codeCases.push({
			name: codeTitle(baseName, `as function with bad variable name`),
			...generateCode({
				type: "Variable",
				name: "render",
				comment,
				inlineComment,
				body: generateCode({
					type: "FuncExpComp",
					body: "return <div>{signal.value}</div>",
				}),
			}),
		});

		codeCases.push({
			name: codeTitle(baseName, `as arrow function with bad variable name`),
			...generateCode({
				type: "Variable",
				name: "render",
				comment,
				inlineComment,
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
		codeCases.push({
			name: codeTitle(c.name, suffix),
			...generateCode({
				type: "Variable",
				name: config.auto ? "VarComp" : "render",
				body: c,
				comment,
				inlineComment,
			}),
		});
	}

	return codeCases;
}

export function assignmentComp(config: CodeConfig): GeneratedCode[] {
	const { name: baseName, comment } = config;
	const codeCases: GeneratedCode[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		codeCases.push({
			name: codeTitle(c.name),
			...generateCode({
				type: "Assignment",
				name: "AssignComp",
				body: c,
				comment,
			}),
		});
	}

	if (!config.auto) {
		codeCases.push({
			name: codeTitle(baseName, "function component with bad variable name"),
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

		codeCases.push({
			name: codeTitle(baseName, "arrow function with bad variable name"),
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
		codeCases.push({
			name: codeTitle(c.name, suffix),
			...generateCode({
				type: "Assignment",
				name: config.auto ? "AssignComp" : "render",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

export function objectPropertyComp(config: CodeConfig): GeneratedCode[] {
	const { name: baseName, comment } = config;
	const codeCases: GeneratedCode[] = [];

	const components = expressionComponents(config);
	for (const c of components) {
		codeCases.push({
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
		codeCases.push({
			name: codeTitle(baseName, "function component with bad property name"),
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

		codeCases.push({
			name: codeTitle(baseName, "arrow function with bad property name"),
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
		codeCases.push({
			name: codeTitle(c.name, suffix),
			...generateCode({
				type: "ObjectProperty",
				name: config.auto ? "ObjComp" : "render_prop",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

export function exportDefaultComp(config: CodeConfig): GeneratedCode[] {
	const { comment } = config;
	const codeCases: GeneratedCode[] = [];

	const components = [
		...declarationComp({ ...config, comment: undefined }),
		...expressionComponents(config),
		...withCallExpWrappers(config),
	];

	for (const c of components) {
		codeCases.push({
			name: c.name + " exported as default",
			...generateCode({
				type: "ExportDefault",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

export function exportNamedComp(config: CodeConfig): GeneratedCode[] {
	const { comment } = config;
	const codeCases: GeneratedCode[] = [];

	// `declarationComp` will put the comment on the function declaration, but in
	// this case we want to put it on the export statement.
	const funcComponents = declarationComp({ ...config, comment: undefined });
	for (const c of funcComponents) {
		codeCases.push({
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
		codeCases.push({
			name: `variable ${name}`,
			...generateCode({
				type: "ExportNamed",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

function expressionHooks(config: CodeConfig): GeneratedCode[] {
	const { name } = config;
	if (config.auto) {
		return [
			{
				name: codeTitle(name, "as function without inline name"),
				...generateCode({
					type: "FuncExpHook",
					body: "return signal.value",
				}),
			},
			{
				name: codeTitle(name, "as function with proper inline name"),
				...generateCode({
					type: "FuncExpHook",
					name: "useCustomHook",
					body: "return signal.value",
				}),
			},
			{
				name: codeTitle(name, "as arrow function with with statement body"),
				...generateCode({
					type: "ArrowFuncHook",
					return: "statement",
					body: "return signal.value",
				}),
			},
			{
				name: codeTitle(name, "as arrow function with with expression body"),
				...generateCode({
					type: "ArrowFuncHook",
					return: "expression",
					body: "signal.value",
				}),
			},
		];
	} else {
		return [
			{
				name: codeTitle(name, "as function with bad inline name"),
				...generateCode({
					type: "FuncExpHook",
					name: "usecustomHook",
					body: "return signal.value",
				}),
			},
			{
				name: codeTitle(name, "as function with no signals"),
				...generateCode({
					type: "FuncExpHook",
					body: "return useState(0)",
				}),
			},
			{
				name: codeTitle(name, "as arrow function with no signals"),
				...generateCode({
					type: "ArrowFuncHook",
					return: "expression",
					body: "useState(0)",
				}),
			},
		];
	}
}

export function declarationHooks(config: CodeConfig): GeneratedCode[] {
	const { name, comment } = config;
	if (config.auto) {
		return [
			{
				name: codeTitle(name, "with proper name and signal usage"),
				...generateCode({
					type: "FuncDeclHook",
					name: "useCustomHook",
					comment,
					body: "return signal.value",
				}),
			},
		];
	} else {
		return [
			{
				name: codeTitle(name, "with bad name"),
				...generateCode({
					type: "FuncDeclHook",
					name: "usecustomHook",
					comment,
					body: "return signal.value",
				}),
			},
			{
				name: codeTitle(name, "with no signals"),
				...generateCode({
					type: "FuncDeclHook",
					name: "useCustomHook",
					comment,
					body: "return useState(0)",
				}),
			},
		];
	}
}

export function variableHooks(config: VariableCodeConfig): GeneratedCode[] {
	const { name, comment, inlineComment } = config;
	const codeCases: GeneratedCode[] = [];

	const hooks = expressionHooks(config);
	for (const h of hooks) {
		codeCases.push({
			name: codeTitle(h.name),
			...generateCode({
				type: "Variable",
				name: "useCustomHook",
				comment,
				inlineComment,
				body: h,
			}),
		});
	}

	if (!config.auto) {
		codeCases.push({
			name: codeTitle(name, "as function with bad variable name"),
			...generateCode({
				type: "Variable",
				name: "usecustomHook",
				comment,
				inlineComment,
				body: generateCode({
					type: "FuncExpHook",
					body: "return signal.value",
				}),
			}),
		});

		codeCases.push({
			name: codeTitle(name, "as arrow function with bad variable name"),
			...generateCode({
				type: "Variable",
				name: "usecustomHook",
				comment,
				inlineComment,
				body: generateCode({
					type: "ArrowFuncHook",
					return: "expression",
					body: "signal.value",
				}),
			}),
		});
	}

	return codeCases;
}

export function exportDefaultHooks(config: CodeConfig): GeneratedCode[] {
	const { comment } = config;
	const codeCases: GeneratedCode[] = [];

	const components = [
		...declarationHooks({ ...config, comment: undefined }),
		...expressionHooks(config),
	];

	for (const c of components) {
		codeCases.push({
			name: c.name + " exported as default",
			...generateCode({
				type: "ExportDefault",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

export function exportNamedHooks(config: CodeConfig): GeneratedCode[] {
	const { comment } = config;
	const codeCases: GeneratedCode[] = [];

	// `declarationHooks` will put the comment on the function declaration, but in
	// this case we want to put it on the export statement.
	const funcHooks = declarationHooks({ ...config, comment: undefined });
	for (const c of funcHooks) {
		codeCases.push({
			name: `function declaration ${c.name}`,
			...generateCode({
				type: "ExportNamed",
				body: c,
				comment,
			}),
		});
	}

	// `variableHooks` will put the comment on the function declaration, but in
	// this case we want to put it on the export statement.
	const varHooks = variableHooks({ ...config, comment: undefined });
	for (const c of varHooks) {
		const name = c.name.replace(" variable ", " exported ");
		codeCases.push({
			name: `variable ${name}`,
			...generateCode({
				type: "ExportNamed",
				body: c,
				comment,
			}),
		});
	}

	return codeCases;
}

/* eslint-disable no-console */
// Command to use to debug the generated code
// ../../../../node_modules/.bin/tsc --target es2020 --module es2020 --moduleResolution node --esModuleInterop --outDir . helpers.ts; mv helpers.js helpers.mjs; node helpers.mjs
async function debug() {
	// @ts-ignore
	const prettier = await import("prettier");
	const format = (code: string) => prettier.format(code, { parser: "babel" });
	console.log("generating...");
	console.time("generated");
	const codeCases: GeneratedCode[] = [
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

	for (const code of codeCases) {
		console.log("=".repeat(80));
		console.log(code.name);
		console.log("input:");
		console.log(await format(code.input));
		console.log("transformed:");
		console.log(await format(code.transformed));
		console.log();
	}
}

// debug();
