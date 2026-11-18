import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

// A DataSnack workspace API key (made in the dashboard under API keys), sent as the bearer.
export class DatasnackApi implements ICredentialType {
	name = 'datasnackApi';

	displayName = 'DataSnack API';

	documentationUrl = 'https://datasnack.ai/docs#n8n';

	icon = { light: 'file:../nodes/Datasnack/datasnack.svg', dark: 'file:../nodes/Datasnack/datasnack.dark.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'dsk_...',
			description: 'A workspace API key, made in the DataSnack dashboard under API keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://datasnack.ai',
			description: 'Leave as it is unless DataSnack gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/v1/gates',
		},
	};
}
