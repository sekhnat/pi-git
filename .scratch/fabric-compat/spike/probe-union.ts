/// <reference path='./guest-union.d.ts' />
// Valid call: compiles.
extensions.github({ op: 'pr_checkout', pr: 27 });
// Missing required `pr`: must FAIL type-check.
extensions.github({ op: 'pr_checkout' });
export {};