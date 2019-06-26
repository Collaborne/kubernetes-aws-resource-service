/**
 * @typedef {object} Statement
 * @property {string} [sid]
 * @property {("Allow"|"Deny")} effect
 * @property {string|string[]} action
 * @property {string|object} [principal]
 * @property {string|string[]} [resource]
 */
/**
 * @typedef {object} Policy
 * @property {string} [id]
 * @property {string} [version="2012-10-17"]
 * @property {Statement[]} statement
 */

module.exports = {};
