/**
 * Lightweight runtime response validation for API endpoints.
 *
 * Catches server-side data shape mismatches early with clear error messages.
 * Null is accepted for any typed field (common for nullable DB columns).
 *
 * Shape format:
 *   fieldName: 'string' | 'number' | 'boolean' | 'any'
 *            | ['arr']                              // array of anything
 *            | ['arr', Shape]                        // array of objects with shape
 *            | ['obj', Shape]                        // nested object
 *   '?fieldName': ...                               // optional field
 */

type FieldType = "string" | "number" | "boolean" | "any";

export type Shape = Record<
  string,
  FieldType | ["arr"] | ["arr", Shape] | ["obj"] | ["obj", Shape]
>;

function getType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function checkShape(data: unknown, shape: Shape, path: string): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `[validation] ${path}: expected object, got ${getType(data)}`
    );
  }

  for (const [key, rule] of Object.entries(shape)) {
    const optional = key.startsWith("?");
    const actualKey = optional ? key.slice(1) : key;
    const value = (data as Record<string, unknown>)[actualKey];

    if (value === undefined) {
      if (!optional) {
        throw new Error(
          `[validation] ${path}: missing required field '${actualKey}'`
        );
      }
      continue;
    }

    const actualType = getType(value);

    // null is accepted for any typed field (nullable DB columns)
    if (actualType === "null") continue;

    const [expectedType, nested] = Array.isArray(rule)
      ? rule
      : [rule, undefined];

    if (expectedType === "any") continue;

    if (Array.isArray(rule) && rule[0] === "arr") {
      if (actualType !== "array") {
        throw new Error(
          `[validation] ${path}: field '${actualKey}' should be array, got ${actualType}`
        );
      }
      // Validate nested object shape for array items
      const arrNested = rule[1];
      if (typeof arrNested === "object" && !Array.isArray(arrNested)) {
        const items = value as unknown[];
        items.forEach((item, i) => {
          if (item !== null && item !== undefined) {
            checkShape(item, arrNested as Shape, `${path}.${actualKey}[${i}]`);
          }
        });
      }
      continue;
    }

    if (Array.isArray(rule) && rule[0] === "obj") {
      if (actualType !== "object") {
        throw new Error(
          `[validation] ${path}: field '${actualKey}' should be object, got ${actualType}`
        );
      }
      const objNested = rule[1];
      if (typeof objNested === "object" && !Array.isArray(objNested)) {
        checkShape(value, objNested as Shape, `${path}.${actualKey}`);
      }
      continue;
    }

    if (actualType !== expectedType) {
      throw new Error(
        `[validation] ${path}: field '${actualKey}' should be ${expectedType}, got ${actualType}`
      );
    }
  }
}

/**
 * Validates a JSON response against the expected shape.
 * Throws a descriptive error if validation fails.
 */
export function validateResponse<T>(data: T, shape: Shape, label: string): T {
  checkShape(data, shape, label);
  return data;
}
