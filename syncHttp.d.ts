export type Fetch = typeof fetch;
/** Rejects 401 as `unauthorized` and any other failure except the statuses the caller handles itself. */
export declare function call(fetchFn: Fetch, url: string, init: RequestInit, handled?: readonly number[]): Promise<Response>;
export declare const bearer: (token: string) => Record<string, string>;
