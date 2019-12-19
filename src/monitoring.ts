/**
 * Provides middleware for monitoring via prometheus
 */

import prometheusBundle from 'express-prom-bundle';

export function initMonitoring() {
	return prometheusBundle({
		promClient: {
			collectDefaultMetrics: {
				// Probe every 5th second.
				timeout: 5000,
			},
		},
	});
}
