/**
 * Provides middleware for monitoring via prometheus
 */

const prometheusBundle = require('express-prom-bundle');
const prometheus = prometheusBundle.promClient;

// Probe every 5th second.
prometheus.collectDefaultMetrics({timeout: 5000});

module.exports = () => prometheusBundle();
