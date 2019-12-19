import fs from 'fs';
import path from 'path';

interface Options {
	server: string;
	insecureSkipTlsVerify: boolean;
	certificateAuthority: string;
	token?: string;
	username: string;
	password: string;
	clientCertificate: string;
	clientKey: string;
}

interface TokenAuth {
	bearer: string;
}
interface UsernamePasswordAuth {
	pass: string;
	user: string;
}
interface K8sConfig {
	insecureSkipTlsVerify: boolean;
	url: string;
	ca?: string;
	auth?: TokenAuth | UsernamePasswordAuth;
	cert?: string;
	key?: string;
}

function createK8sConfigWithServer(options: Options) {
	const k8sConfig: K8sConfig = {
		insecureSkipTlsVerify: options.insecureSkipTlsVerify,
		url: options.server,
	};
	if (options.certificateAuthority) {
		k8sConfig.ca = fs.readFileSync(options.certificateAuthority, 'utf8');
	}
	if (options.token) {
		k8sConfig.auth = {
			bearer: options.token,
		};
	} else if (options.username && options.password) {
		k8sConfig.auth = {
			pass: options.password,
			user: options.username,
		};
	} else if (options.clientCertificate && options.clientKey) {
		k8sConfig.cert = fs.readFileSync(options.clientCertificate, 'utf8');
		k8sConfig.key = fs.readFileSync(options.clientKey, 'utf8');
	}

	return k8sConfig;
}

function createK8sConfigFromEnvironment(env: {[key: string]: string | undefined}) {
	// Runs in Kubernetes
	const credentialsPath = '/var/run/secrets/kubernetes.io/serviceaccount/';
	return {
		auth: {
			bearer: fs.readFileSync(path.resolve(credentialsPath, 'token'), 'utf8'),
		},
		ca: fs.readFileSync(path.resolve(credentialsPath, 'ca.crt'), 'utf8'),
		url: `https://${env.KUBERNETES_SERVICE_HOST}:${env.KUBERNETES_SERVICE_PORT}`,
	};
}

/**
 * Creates basic configuration for accessing the Kubernetes API server
 *
 * @param args Command line arguments
 * @returns Kubernetes client configuration
 */
export function createK8sConfig(args: any) {
	let k8sConfig;
	if (args.server) {
		// For local development
		k8sConfig = createK8sConfigWithServer(args);
	} else if (process.env.KUBERNETES_SERVICE_HOST) {
		k8sConfig = createK8sConfigFromEnvironment(process.env);
	} else {
		throw new Error('Unknown Kubernetes API server');
	}

	return k8sConfig;
}
