// Unit tests of the node's helpers, run on the built package: npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapperFields, cleanValues, idempotencyKey, needsPerson, parseJson } = require('../dist/nodes/Datasnack/GenericFunctions.js');
const NODE = { id: 'n', name: 'DataSnack', type: 'n8n-nodes-datasnack.datasnack', typeVersion: 1, position: [0, 0], parameters: {} };
const { Datasnack } = require('../dist/nodes/Datasnack/Datasnack.node.js');

const fields = {
	amount_usd: { type: 'number', required: true },
	days: { type: 'integer' },
	tier: { type: 'enum', values: ['standard', 'plus'] },
	damaged: { type: 'boolean' },
	tags: { type: 'list' },
	reason: { type: 'string' },
};

test('mapper fields keep the gate order and types', () => {
	const m = mapperFields(fields);
	assert.deepEqual(m.map((f) => f.id), ['amount_usd', 'days', 'tier', 'damaged', 'tags', 'reason']);
	assert.deepEqual(m.map((f) => f.type), ['number', 'number', 'options', 'boolean', 'array', 'string']);
	assert.equal(m[0].required, true);
	assert.equal(m[1].required, false);
	assert.deepEqual(m[2].options, [{ name: 'standard', value: 'standard' }, { name: 'plus', value: 'plus' }]);
	assert.equal(mapperFields(fields, true)[1].required, true);
	assert.deepEqual(mapperFields(null), []);
});

test('values get their types and empty ones are left out', () => {
	const v = cleanValues({ amount_usd: '40.5', days: 41, tier: 'plus', damaged: 'false', tags: 'a, b,', reason: '', extra: 'x' }, fields);
	assert.deepEqual(v, { amount_usd: 40.5, days: 41, tier: 'plus', damaged: false, tags: ['a', 'b'], extra: 'x' });
	assert.deepEqual(cleanValues({ tags: '["x","y"]', damaged: true, reason: 12 }, fields), { tags: ['x', 'y'], damaged: true, reason: '12' });
	assert.deepEqual(cleanValues({ amount_usd: 'lots' }, fields), { amount_usd: 'lots' }); // the gate says what is wrong
	assert.deepEqual(cleanValues(null, fields), {});
});

test('the idempotency key is stable for a retry, differs across runs and items, and can be set', () => {
	assert.equal(idempotencyKey('', '812', 'Approve refund', 0, 3), 'n8n-812-Approve_refund-0-3');
	assert.equal(idempotencyKey('', '812', 'Approve refund', 0, 3), idempotencyKey('', '812', 'Approve refund', 0, 3));
	assert.notEqual(idempotencyKey('', '812', 'Approve refund', 0, 3), idempotencyKey('', '812', 'Approve refund', 0, 4));
	// A loop runs the node again in the same execution, with item indices from 0.
	assert.notEqual(idempotencyKey('', '812', 'Approve refund', 0, 0), idempotencyKey('', '812', 'Approve refund', 1, 0));
	assert.equal(idempotencyKey('  order-1001 ', '812', 'x', 0, 0), 'order-1001');
	assert.equal(idempotencyKey('k'.repeat(300), '1', 'x', 0, 0).length, 255);
	assert.equal(idempotencyKey('', '', 'x', 0, 0), '');
	assert.equal(idempotencyKey('', undefined, 'x', 0, 0), '');
});

test('tier none needs a person', () => {
	assert.equal(needsPerson({ decided_by: { tier: 'none' } }), true);
	assert.equal(needsPerson({ decided_by: { tier: 'rule' } }), false);
	assert.equal(needsPerson({ decided_by: { tier: 'default' } }), false);
});

test('JSON parameters', () => {
	assert.deepEqual(parseJson(NODE, '{"a": 1}', 'Input'), { a: 1 });
	assert.deepEqual(parseJson(NODE, { a: 1 }, 'Input'), { a: 1 });
	assert.deepEqual(parseJson(NODE, '  ', 'Input'), {});
	assert.throws(() => parseJson(NODE, '{a', 'Input'), /not valid JSON/);
	assert.throws(() => parseJson(NODE, '[1]', 'Input'), /JSON object/);
});

test('the node describes itself', () => {
	const d = new Datasnack().description;
	assert.equal(d.name, 'datasnack');
	assert.deepEqual(d.credentials, [{ name: 'datasnackApi', required: true }]);
	assert.match(d.outputs, /Not confirmed/);
	assert.match(d.outputs, /"Confirmed"/);
	const ops = d.properties.find((p) => p.name === 'operation').options.map((o) => o.value);
	assert.deepEqual(ops, ['decide', 'correct', 'observe']);
});
