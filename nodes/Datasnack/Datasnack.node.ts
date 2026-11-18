import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeListSearchResult,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
	type ResourceMapperFields,
} from 'n8n-workflow';

import {
	api,
	cleanValues,
	gateConfig,
	gateOptions,
	idempotencyKey,
	mapperFields,
	needsPerson,
	parseJson,
	type Decision,
	type GateField,
} from './GenericFunctions';

// The node's outputs: Decide has two, "Confirmed" (an answer code gave) and "Not confirmed" (no rule applied: send
// it to your own AI or a person, then record the answer); the other operations have one.
const outputs =
	'={{ !$parameter.operation || $parameter.operation === "decide" ? [{"type": "main", "displayName": "Confirmed"}, {"type": "main", "displayName": "Not confirmed"}] : [{"type": "main"}] }}';

const gateLocator = {
	displayName: 'Gate',
	name: 'gate',
	type: 'resourceLocator' as const,
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The gate: one repeated decision, made in the DataSnack dashboard',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list' as const,
			typeOptions: { searchListMethod: 'searchGates', searchable: true },
		},
		{
			displayName: 'By Slug',
			name: 'id',
			type: 'string' as const,
			placeholder: 'refund-approval',
			validation: [
				{
					type: 'regex' as const,
					properties: { regex: '^[a-z0-9][a-z0-9-]{0,63}$', errorMessage: 'A slug is lowercase letters, digits and hyphens' },
				},
			],
		},
	],
};

export class Datasnack implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DataSnack',
		name: 'datasnack',
		usableAsTool: true,
		icon: { light: 'file:datasnack.svg', dark: 'file:datasnack.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter.operation }}',
		description:
			'Decide a repeated business decision by tested rules, send what no rule covers to a person, and learn from their answers',
		defaults: { name: 'DataSnack' },
		inputs: [NodeConnectionTypes.Main],
		outputs,
		credentials: [{ name: 'datasnackApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Decide',
						value: 'decide',
						action: 'Decide a request',
						description:
							'Ask the gate. An answer code confirmed comes out of "Confirmed"; one no rule covers comes out of "Not confirmed", for your own AI or a person.',
					},
					{
						name: 'Record the Answer',
						value: 'correct',
						action: 'Record the answer',
						description:
							'Send back the answer your own AI or a person gave to a decision (or a correction of one). The gate repeats it for the same request and learns from it.',
					},
					{
						name: 'Observe',
						value: 'observe',
						action: 'Observe your system s answer',
						description:
							'For a gate that learns from your own system: send a request and the answer your system gave',
					},
				],
				default: 'decide',
			},
			gateLocator,

			// ---- the request
			{
				displayName: 'Input',
				name: 'inputMode',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['decide', 'observe'] } },
				options: [
					{ name: 'Map Each Field', value: 'map' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'map',
			},
			{
				displayName: 'Input Fields',
				name: 'input',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				displayOptions: { show: { operation: ['decide', 'observe'], inputMode: ['map'] } },
				typeOptions: {
					loadOptionsDependsOn: ['gate.value'],
					resourceMapper: {
						resourceMapperMethod: 'getInputFields',
						mode: 'map',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						supportAutoMap: true,
						noFieldsError: 'This gate has no input fields yet. A gate that learns from your system learns them from what you send: use JSON.',
					},
				},
			},
			{
				displayName: 'Input (JSON)',
				name: 'inputJson',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: { show: { operation: ['decide', 'observe'], inputMode: ['json'] } },
				description: 'The request as a JSON object of the gate\'s input fields',
			},

			// ---- the answer (observe, correct)
			{
				displayName: 'Decision ID',
				name: 'decisionId',
				type: 'string',
				default: '={{ $json.decision_id }}',
				required: true,
				displayOptions: { show: { operation: ['correct'] } },
				description: 'The decision_id the Decide step gave',
			},
			{
				displayName: 'Answer',
				name: 'outputMode',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['observe', 'correct'] } },
				options: [
					{ name: 'Map Each Field', value: 'map' },
					{ name: 'JSON', value: 'json' },
				],
				default: 'map',
			},
			{
				displayName: 'Answer Fields',
				name: 'output',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				displayOptions: { show: { operation: ['observe', 'correct'], outputMode: ['map'] } },
				typeOptions: {
					loadOptionsDependsOn: ['gate.value'],
					resourceMapper: {
						resourceMapperMethod: 'getOutputFields',
						mode: 'map',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						supportAutoMap: false,
						noFieldsError: 'This gate has no answer fields yet. A gate that learns from your system learns them from what you send: use JSON.',
					},
				},
			},
			{
				displayName: 'Answer (JSON)',
				name: 'outputJson',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: { show: { operation: ['observe', 'correct'], outputMode: ['json'] } },
				description: 'The answer as a JSON object of the gate\'s output fields, e.g. {"decision": "approve"}',
			},

			// ---- options
			{
				displayName: 'Options',
				name: 'requestOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['decide', 'observe'] } },
				options: [
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description:
							'Requests with the same key are answered once; a retry gets the first answer. Empty: a key made from this execution, node and item, so Retry On Fail never decides twice. Set your own (an order ID) to be safe across executions too.',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'correctionOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['correct'] } },
				options: [
					{
						displayName: 'Who Answered',
						name: 'source',
						type: 'options',
						options: [
							{ name: 'A Person', value: 'person', description: 'Outranks everything when rules are drafted and checked' },
							{ name: 'My Own AI Model', value: 'model', description: 'Counts as the answer, like the AI the gate learned from' },
						],
						default: 'model',
						description: 'Who gave this answer',
					},
					{
						displayName: 'Note',
						name: 'note',
						type: 'string',
						default: '',
						description: 'Why, in a sentence; shown with the decision (up to 1,000 characters)',
					},
					{
						displayName: 'Who',
						name: 'who',
						type: 'string',
						default: '',
						description: 'Who answered, e.g. their email; shown with the decision',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async searchGates(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const all = await gateOptions(this);
				const f = (filter ?? '').toLowerCase();
				return {
					results: all
						.filter((g) => !f || g.name.toLowerCase().includes(f) || String(g.value).includes(f))
						.map((g) => ({ name: g.name, value: g.value as string })),
				};
			},
		},
		resourceMapping: {
			async getInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const slug = this.getNodeParameter('gate', undefined, { extractValue: true }) as string;
				if (!slug) return { fields: [], emptyFieldsNotice: 'Choose a gate first.' };
				const cfg = await gateConfig(this, slug);
				return { fields: mapperFields(cfg.input) };
			},
			async getOutputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const slug = this.getNodeParameter('gate', undefined, { extractValue: true }) as string;
				if (!slug) return { fields: [], emptyFieldsNotice: 'Choose a gate first.' };
				const cfg = await gateConfig(this, slug);
				return { fields: mapperFields(cfg.output, true) };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const decided: INodeExecutionData[] = [];
		const toPerson: INodeExecutionData[] = [];
		const fieldsBySlug = new Map<string, { input: Record<string, GateField> | null; output: Record<string, GateField> | null }>();

		const fieldsOf = async (slug: string) => {
			let f = fieldsBySlug.get(slug);
			if (!f) {
				const cfg = await gateConfig(this, slug);
				f = { input: cfg.input, output: cfg.output };
				fieldsBySlug.set(slug, f);
			}
			return f;
		};
		const read = async (i: number, slug: string, side: 'input' | 'output'): Promise<IDataObject> => {
			const mode = this.getNodeParameter(side === 'input' ? 'inputMode' : 'outputMode', i) as string;
			if (mode === 'json') {
				return parseJson(this.getNode(), this.getNodeParameter(side === 'input' ? 'inputJson' : 'outputJson', i), side === 'input' ? 'Input' : 'Answer');
			}
			const values = this.getNodeParameter(`${side}.value`, i, {}) as IDataObject | null;
			return cleanValues(values, (await fieldsOf(slug))[side]);
		};

		// The node's run in this execution: a loop (Loop Over Items, batches) runs it again with item indices from 0,
		// while Retry On Fail keeps it, so it goes into the idempotency key.
		const runIndex = Number((this.getWorkflowDataProxy(0) as unknown as IDataObject).$runIndex ?? 0);

		for (let i = 0; i < items.length; i++) {
			let slug = '';
			let input: IDataObject | undefined;
			try {
				slug = this.getNodeParameter('gate', i, '', { extractValue: true }) as string;
				const path = `/v1/gates/${encodeURIComponent(slug)}`;
				if (operation === 'decide' || operation === 'observe') {
					const opts = this.getNodeParameter('requestOptions', i, {}) as IDataObject;
					const key = idempotencyKey(String(opts.idempotencyKey ?? ''), this.getExecutionId(), this.getNode().name, runIndex, i);
					const headers: Record<string, string> = key ? { 'Idempotency-Key': key } : {};
					input = await read(i, slug, 'input');
					if (operation === 'decide') {
						const d = (await api(this, 'POST', `${path}/decide`, { input }, headers)) as unknown as Decision;
						const item = { json: { ...d, gate: slug, input } as unknown as IDataObject, pairedItem: { item: i } };
						(needsPerson(d) ? toPerson : decided).push(item);
					} else {
						const output = await read(i, slug, 'output');
						const res = await api(this, 'POST', `${path}/observe`, { input, output }, headers);
						decided.push({ json: { ...res, gate: slug, input, output }, pairedItem: { item: i } });
					}
				} else if (operation === 'correct') {
					const id = String(this.getNodeParameter('decisionId', i)).trim();
					if (!id) throw new NodeOperationError(this.getNode(), 'Decision ID is empty: map the decision_id from the Decide step', { itemIndex: i });
					const opts = this.getNodeParameter('correctionOptions', i, {}) as IDataObject;
					const output = await read(i, slug, 'output');
					const body: IDataObject = { output };
					if (opts.note) body.note = String(opts.note);
					if (opts.who) body.who = String(opts.who);
					body.source = String(opts.source ?? 'model');
					const res = await api(this, 'POST', `/v1/decisions/${encodeURIComponent(id)}/feedback`, body);
					decided.push({ json: { ...res, decision_id: id, gate: slug, output }, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation ${operation}`, { itemIndex: i });
				}
			} catch (error) {
				const failure =
					error instanceof NodeOperationError || error instanceof NodeApiError
						? error
						: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i, message: errorText(error) });
				if (!this.continueOnFail()) throw failure;
				if (operation === 'decide') {
					// A request the gate could not decide is never an answer to act on: it goes where unconfirmed requests go.
					// (n8n keeps only the error on the item; the request is the paired item of the node before.)
					toPerson.push({ json: { error: errorText(error), gate: slug, ...(input ? { input } : {}) }, error: failure, pairedItem: { item: i } });
				} else {
					decided.push({ json: { error: errorText(error) }, error: failure, pairedItem: { item: i } });
				}
			}
		}
		return operation === 'decide' ? [decided, toPerson] : [decided];
	}
}

// errorText is the API's own message when there is one: {"error": "...", "problems": [...]}.
type ErrorLike = {
	message?: string;
	error?: unknown;
	response?: { body?: unknown; data?: unknown };
	cause?: { response?: { data?: unknown } };
};

function errorText(error: unknown): string {
	const e = (error ?? {}) as ErrorLike;
	const body = e.response?.body ?? e.response?.data ?? e.cause?.response?.data ?? e.error;
	const parsed = (typeof body === 'string' ? safeParse(body) : body) as { error?: unknown; problems?: unknown } | undefined;
	if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
		const message = parsed.error;
		const problems: string[] = Array.isArray(parsed.problems) ? parsed.problems.map(String) : [];
		const missing = problems.filter((p) => !message.includes(p));
		return missing.length ? `${message}: ${missing.join('; ')}` : message;
	}
	return e.message ?? String(error);
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return undefined;
	}
}
