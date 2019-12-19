import { AWSError } from 'aws-sdk';
import { PromiseResult } from 'aws-sdk/lib/request';

export type Effect = 'Allow' | 'Deny';
export interface Statement {
	Sid?: string;
	Effect: Effect;
	Action: string | string[];
	Principal?: string|object;
	Resource?: string|string[];
}

export interface Policy {
	Id?: string;
	Version?: '2012-10-17';
	Statement: Statement[];
}

export interface AWSOperation<T> {
	promise: () => Promise<PromiseResult<T, AWSError>>;
}
