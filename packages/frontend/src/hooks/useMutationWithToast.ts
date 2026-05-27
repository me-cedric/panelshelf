import { useMutation, type UseMutationOptions, type MutationFunction } from "@tanstack/react-query";
import { useToast } from "../components/Toast.tsx";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastMessage {
  message: string;
  description?: string;
  type?: ToastType;
}

type SuccessToastFn<TData, TVariables> =
  | string
  | ToastMessage
  | ((data: TData, variables: TVariables) => ToastMessage | string);

type ErrorToastFn<TError, TVariables> =
  | string
  | ToastMessage
  | ((err: TError, variables: TVariables) => ToastMessage | string);

interface ToastConfig<TData, TError, TVariables> {
  /** Toast shown on mutation success. Default type: "success" */
  success?: SuccessToastFn<TData, TVariables>;
  /** Toast shown on mutation error. Default type: "error" */
  error?: ErrorToastFn<TError, TVariables>;
}

type UseMutationWithToastOptions<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
> = Omit<UseMutationOptions<TData, TError, TVariables, TContext>, "mutationFn"> & {
  mutationFn: MutationFunction<TData, TVariables>;
  /** Auto-show toast notifications on success/error */
  toast?: ToastConfig<TData, TError, TVariables>;
};

function resolveToast<T>(
  spec: T | undefined,
  dataOrErr: unknown,
  variables: unknown,
  defaultType: ToastType,
): { message: string; description?: string; type: ToastType } | null {
  if (!spec) return null;

  let resolved: string | ToastMessage;
  if (typeof spec === "function") {
    resolved = (spec as (dataOrErr: unknown, variables: unknown) => ToastMessage | string)(
      dataOrErr,
      variables,
    );
  } else {
    resolved = spec as string | ToastMessage;
  }

  if (typeof resolved === "string") {
    return { message: resolved, type: defaultType };
  }

  return {
    message: resolved.message,
    description: resolved.description,
    type: resolved.type || defaultType,
  };
}

/**
 * Wraps `useMutation` with automatic toast notifications.
 *
 * @example
 * ```ts
 * const deleteMutation = useMutationWithToast({
 *   mutationFn: deleteSource,
 *   toast: {
 *     success: (_data, id) => ({ message: `Source deleted`, type: "success" }),
 *     error: (err) => ({ message: "Delete failed", description: err.message }),
 *   },
 *   onSuccess: () => queryClient.invalidateQueries(...),
 * });
 * ```
 */
export function useMutationWithToast<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(options: UseMutationWithToastOptions<TData, TError, TVariables, TContext>) {
  const { addToast } = useToast();
  const { toast, onSuccess: userOnSuccess, onError: userOnError, ...mutationOptions } = options;

  return useMutation<TData, TError, TVariables, TContext>({
    ...mutationOptions,
    onSuccess(data, variables, context, ...rest) {
      if (toast?.success) {
        const resolved = resolveToast(toast.success, data, variables, "success");
        if (resolved) addToast(resolved);
      }
      userOnSuccess?.(data, variables, context, ...rest);
    },
    onError(err, variables, context, ...rest) {
      if (toast?.error) {
        const resolved = resolveToast(toast.error, err, variables, "error");
        if (resolved) addToast(resolved);
      }
      userOnError?.(err, variables, context, ...rest);
    },
  });
}
