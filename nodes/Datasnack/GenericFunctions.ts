import { NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	INode,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperField,
} from 'n8n-workflow';

// One field of a gate's input or output, as the gate's config lists it.
export interface GateField {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'list';
	required?: boolean;
	values?: string[];
	description?: string;
	decides?: boolean;
}

export interface GateConfig {
	name: string;
	slug: string;
	observed?: boolean;
	mode: string;
	input: Record<string, GateField> | null;
	output: Record<string, GateField> | null;
}

// A decide response.
export interface Decision {
	decision_id: string;
	output: IDataObject;
	reason: string;
	decided_by: { tier: string; rule?: string; version?: number };
	ms: number;
}

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

export async function baseUrl(ctx: Ctx): Promise<string> {
	const creds = await ctx.getCredentials('datasnackApi');
	return String(creds.baseUrl || 'https://datasnack.ai').replace(/\/+$/, '');
}

// api calls the DataSnack API with the workspace key.
export async function api(
	ctx: Ctx,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	headers?: Record<string, string>,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: (await baseUrl(ctx)) + path,
		json: true,
		headers: { Accept: 'application/json', ...headers },
	};
	if (body !== undefined) options.body = body;
	return ctx.helpers.httpRequestWithAuthentication.call(ctx, 'datasnackApi', options);
}

export async function gateConfig(ctx: Ctx, slug: string): Promise<GateConfig> {
	const res = await api(ctx, 'GET', `/v1/gates/${encodeURIComponent(slug)}/config`);
	return res.config as GateConfig;
}

export async function gateOptions(ctx: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const res = await api(ctx, 'GET', '/v1/gates');
	return ((res.gates ?? []) as Array<{ slug: string; name: string; mode: string }>).map((g) => ({
		name: g.name,
		value: g.slug,
		description: `${g.slug} · ${g.mode}`,
	}));
}

// mapperFields turns a gate's fields into the fields n8n's mapper shows, in the gate's order.
export function mapperFields(fields: Record<string, GateField> | null, allRequired = false): ResourceMapperField[] {
	return Object.entries(fields ?? {}).map(([id, f]) => {
		const field: ResourceMapperField = {
			id,
			displayName: id,
			required: allRequired || !!f.required,
			defaultMatch: false,
			display: true,
			type: 'string',
		};
		switch (f.type) {
			case 'number':
			case 'integer':
				field.type = 'number';
				break;
			case 'boolean':
				field.type = 'boolean';
				break;
			case 'enum':
				field.type = 'options';
				field.options = (f.values ?? []).map((v) => ({ name: v, value: v }));
				break;
			case 'list':
				field.type = 'array';
				break;
		}
		return field;
	});
}

// cleanValues turns the mapper's values into a request the gate accepts: empty optional fields are left out (not
// given), and numbers, booleans and lists get their types.
export function cleanValues(values: IDataObject | null | undefined, fields: Record<string, GateField> | null): IDataObject {
	const out: IDataObject = {};
	for (const [name, raw] of Object.entries(values ?? {})) {
		if (raw === null || raw === undefined || raw === '') continue;
		const f = fields?.[name];
		out[name] = (f ? convert(raw, f) : raw) as IDataObject[string];
	}
	return out;
}

function convert(v: unknown, f: GateField): unknown {
	switch (f.type) {
		case 'number':
		case 'integer': {
			if (typeof v === 'number') return v;
			const n = Number(String(v).trim());
			return Number.isFinite(n) ? n : v;
		}
		case 'boolean':
			if (typeof v === 'boolean') return v;
			if (/^(true|yes|1)$/i.test(String(v).trim())) return true;
			if (/^(false|no|0)$/i.test(String(v).trim())) return false;
			return v;
		case 'list':
			if (Array.isArray(v)) return v.map(String);
			if (typeof v === 'string') {
				const s = v.trim();
				if (s.startsWith('[')) {
					try {
						const parsed = JSON.parse(s);
						if (Array.isArray(parsed)) return parsed.map(String);
					} catch {
						// a list written with commas, below
					}
				}
				return s.split(',').map((x) => x.trim()).filter((x) => x !== '');
			}
			return v;
	}
	return typeof v === 'string' ? v : String(v);
}

// parseJson reads a JSON parameter, which n8n gives as an object or as text.
export function parseJson(node: INode, v: unknown, what: string): IDataObject {
	if (typeof v === 'string') {
		const s = v.trim();
		if (s === '') return {};
		let parsed: unknown;
		try {
			parsed = JSON.parse(s);
		} catch {
			throw new NodeOperationError(node, `${what} is not valid JSON`);
		}
		v = parsed;
	}
	if (v === null || typeof v !== 'object' || Array.isArray(v)) {
		throw new NodeOperationError(node, `${what} must be a JSON object`);
	}
	return v as IDataObject;
}

// idempotencyKey is the key a request is sent with: the one set on the node, or one made from the execution, the
// node, its run (a loop runs the node again in one execution) and the item. That one stays the same when n8n retries
// the step (Retry On Fail), so a retry never makes a second decision. Without an execution id there is no key.
export function idempotencyKey(custom: string, executionId: string | undefined, nodeName: string, runIndex: number, itemIndex: number): string {
	const key = custom.trim();
	if (key !== '') return key.slice(0, 255);
	if (!executionId) return '';
	return `n8n-${executionId}-${nodeName}-${runIndex}-${itemIndex}`.replace(/[^\x21-\x7e]/g, '_').slice(0, 255);
}

// needsPerson reports whether no rule answered and a person (or your own system) must decide.
export function needsPerson(d: Decision): boolean {
	return d.decided_by?.tier === 'none';
}
