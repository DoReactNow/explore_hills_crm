// The response envelope shared by the server, the browser client and the tests (Section 4.3).
// Types only, so the browser bundle can import it without pulling in server code.
import type { ErrorCode } from "@/shared/errors/errorCatalog";

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldError[];
    requestId: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;
