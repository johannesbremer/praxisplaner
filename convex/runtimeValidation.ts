import {
  jsonToConvex,
  type Validator,
  type ValidatorJSON,
} from "convex/values";

export function assertMatchesConvexValidator<T>(
  validator: Validator<T, "required", string>,
  value: unknown,
  errorMessage: string,
): asserts value is T {
  if (!matchesConvexValidator(validator, value)) {
    throw new Error(errorMessage);
  }
}

export function matchesConvexValidator<T>(
  validator: Validator<T, "required", string>,
  value: unknown,
): value is T {
  const validatorWithJson = validator as unknown as { json: ValidatorJSON };
  return matchesValidatorJson(validatorWithJson.json, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}

function matchesRecordKeyValidator(
  validatorJson: Extract<ValidatorJSON, { type: "record" }>["keys"],
  value: string,
): boolean {
  switch (validatorJson.type) {
    case "id":
    case "string": {
      return true;
    }
    case "union": {
      return validatorJson.value.some((member) =>
        matchesRecordKeyValidator(member, value),
      );
    }
  }
}

function matchesValidatorJson(
  validatorJson: ValidatorJSON,
  value: unknown,
): boolean {
  switch (validatorJson.type) {
    case "any": {
      return true;
    }
    case "array": {
      return (
        Array.isArray(value) &&
        value.every((entry) => matchesValidatorJson(validatorJson.value, entry))
      );
    }
    case "bigint": {
      return typeof value === "bigint";
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "bytes": {
      return value instanceof ArrayBuffer;
    }
    case "id":
    case "string": {
      return typeof value === "string";
    }
    case "literal": {
      return Object.is(value, jsonToConvex(validatorJson.value));
    }
    case "null": {
      return value === null;
    }
    case "number": {
      return typeof value === "number";
    }
    case "object": {
      if (!isPlainObject(value)) {
        return false;
      }

      const allowedKeys = new Set(Object.keys(validatorJson.value));
      if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
        return false;
      }

      for (const [key, field] of Object.entries(validatorJson.value)) {
        const fieldValue = value[key];
        if (fieldValue === undefined) {
          if (!field.optional) {
            return false;
          }
          continue;
        }

        if (!matchesValidatorJson(field.fieldType, fieldValue)) {
          return false;
        }
      }

      return true;
    }
    case "record": {
      if (!isPlainObject(value)) {
        return false;
      }

      return Object.entries(value).every(
        ([key, entryValue]) =>
          matchesRecordKeyValidator(validatorJson.keys, key) &&
          matchesValidatorJson(validatorJson.values.fieldType, entryValue),
      );
    }
    case "union": {
      return validatorJson.value.some((member) =>
        matchesValidatorJson(member, value),
      );
    }
  }
}
