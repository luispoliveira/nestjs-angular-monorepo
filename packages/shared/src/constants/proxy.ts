/**
 * How many reverse proxies in front of an app are trusted to append the real
 * client address to `X-Forwarded-For`: nginx (`$proxy_add_x_forwarded_for`)
 * in the documented topology. Express `trust proxy` and the audit hook read
 * the client address with this same rule, so neither trusts the first,
 * client-supplied, entry.
 */
export const TRUSTED_PROXY_HOPS = 1;
