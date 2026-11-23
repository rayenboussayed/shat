import { useEffect, useState } from "react";
import type { LoadState } from "shat-api-types";

/**
 * The part of a typed GET response that {@link useApiGet} needs.
 *
 * Both fields are optional because a successful response carries no `error`
 * and a failed response carries no `data`.
 */
interface GetResponse {
  readonly data?: unknown;
  readonly error?: unknown;
}

/**
 * A one-shot GET request bound to the abort signal supplied by {@link useApiGet}.
 */
type GetRequest = (signal: AbortSignal) => Promise<GetResponse>;

/**
 * Converts a raw successful response body into the value a component stores.
 *
 * @typeParam T - The stored value type.
 * @param data - The response body of a successful, non-aborted GET.
 * @returns The mapped value.
 */
type DataMapper<T> = (data: unknown) => T;

/**
 * The load state and mapped value returned by {@link useApiGet}.
 *
 * `value` is `undefined` until a successful response has been mapped.
 */
interface ApiGetState<T> {
  readonly state: LoadState;
  readonly value: T | undefined;
}

/**
 * Runs a single typed GET on mount, maps its response and aborts on unmount.
 *
 * The request runs once per mount. Aborting on unmount keeps a late response
 * from updating state after the component is gone. `map` owns structural
 * validation of the raw payload and any fallback to an empty value; a thrown
 * request or mapper is reported as the `"error"` state.
 *
 * @typeParam T - The stored value type produced by `map`.
 * @param request - Issues the GET with the signal managed by this hook.
 * @param map - Maps a successful response body to the stored value.
 * @returns The current {@link LoadState} and the mapped value (once ready).
 */
export function useApiGet<T>(request: GetRequest, map: DataMapper<T>): ApiGetState<T> {
  const [state, setState] = useState<LoadState>("loading");
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await request(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (error !== undefined || data === undefined) {
          if (!controller.signal.aborted) {
            setState("error");
          }
          return;
        }
        const mapped = map(data);
        if (controller.signal.aborted) {
          return;
        }
        if (!controller.signal.aborted) {
          setValue(mapped);
          setState("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setState("error");
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [request, map]);

  return { state, value };
}
