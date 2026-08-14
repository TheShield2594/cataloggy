/**
 * The declarative half of request validation.
 *
 * Fastify compiles a JSON Schema attached to a route into a validator that runs
 * before the handler, which is strictly better than the `typeof` ladders these
 * routes grew one at a time: the rules are visible in one block instead of
 * spread over sixty lines, and a field cannot be checked on one route and
 * forgotten on its sibling. Nothing here changes what a caller sees on success.
 *
 * Two things make it safe to adopt route by route rather than all at once:
 *
 *   - `schemaErrorFormatter` phrases a failure the way the hand-written checks
 *     already do ("imdbId is required", "type must be one of: movie, episode"),
 *     so a converted route's 400s read like an unconverted one's.
 *   - `validationErrorBody` re-shapes the thrown error into `{ error }`, which
 *     is the shape every route answers with and the only one the web client
 *     knows how to read. Without it a schema failure would arrive as Fastify's
 *     `{ statusCode, error, message }` and surface in the UI as "Bad Request"
 *     with the useful half dropped.
 *
 * Both are wired once — in `index.ts` for the real server, and in the route
 * test fixture — so a route only has to declare its schema.
 */

import type {
  FastifyError,
  FastifyInstance,
  FastifySchemaValidationError,
  FastifyServerOptions,
} from "fastify";

/**
 * Fastify's ajv coerces by default — `{"name": 42}` would arrive as `"42"` —
 * which is right for a query string, where everything is a string to begin
 * with, and wrong for a JSON body, where the caller already chose a type. The
 * hand-written checks all reject a number where a string belongs, so coercion
 * would make a converted route quietly more permissive than its neighbours.
 *
 * The cost is that a `querystring` schema has to declare its fields as strings
 * and parse them itself, which is what the routes here already do by hand.
 */
export const requestSchemaOptions: Pick<FastifyServerOptions, "ajv"> = {
  ajv: { customOptions: { coerceTypes: false } },
};

/** Bounds shared by the fields that show up in more than one payload. */
export const MAX_IMDB_ID_LENGTH = 32;
export const MAX_TITLE_LENGTH = 300;
export const MAX_URL_LENGTH = 2_048;

/**
 * A runtime in minutes. Generous enough for the longest film anyone has sat
 * through, and finite so `new Date(Date.now() + runtime * 60_000)` cannot be
 * handed a number that makes an Invalid Date.
 */
export const MAX_RUNTIME_MINUTES = 24 * 60;

/**
 * Optional fields are declared nullable because the web client sends `null` for
 * "no value" in several payloads, and a schema that only allows the type would
 * reject what has always been accepted.
 */
export const nullable = (schema: Record<string, unknown>, type: string | string[]) => ({
  ...schema,
  type: Array.isArray(type) ? [...type, "null"] : [type, "null"],
});

// ─── Error phrasing ───

/** `/season` → `season`, `/lists/0/name` → `lists.0.name`, `` → the fallback. */
const fieldName = (instancePath: string, fallback: string): string =>
  instancePath ? instancePath.replace(/^\//, "").replace(/\//g, ".") : fallback;

const articleFor = (type: string): string => (/^[aeiou]/i.test(type) ? "an" : "a");

/**
 * Turns the first validation failure into one sentence in the same voice as the
 * hand-written checks. Only the first: Fastify's ajv stops at it by default,
 * and a caller fixing one field at a time is no worse off than they were.
 */
export const schemaErrorFormatter = (
  errors: FastifySchemaValidationError[],
  dataVar: string
): Error => {
  const error = errors[0];
  if (!error) return new Error(`${dataVar} is invalid`);

  const params = error.params;
  const field = fieldName(error.instancePath, dataVar);

  switch (error.keyword) {
    case "required":
      return new Error(`${String(params.missingProperty)} is required`);
    case "enum": {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues : [];
      return new Error(`${field} must be one of: ${allowed.join(", ")}`);
    }
    case "type": {
      // A nullable field's type is a list; naming every member of it reads
      // worse than naming the one that matters.
      const type = String(params.type).split(",").filter((t) => t !== "null")[0] ?? String(params.type);
      return new Error(`${field} must be ${articleFor(type)} ${type}`);
    }
    case "minLength":
      return Number(params.limit) <= 1
        ? new Error(`${field} must not be empty`)
        : new Error(`${field} must be at least ${String(params.limit)} characters`);
    case "maxLength":
      return new Error(`${field} must be at most ${String(params.limit)} characters`);
    case "minimum":
    case "exclusiveMinimum":
      return new Error(`${field} must be at least ${String(params.limit)}`);
    case "maximum":
    case "exclusiveMaximum":
      return new Error(`${field} must be at most ${String(params.limit)}`);
    case "pattern":
      return new Error(`${field} is not in the expected format`);
    default:
      return new Error(`${field} ${error.message ?? "is invalid"}`);
  }
};

/** True for the error Fastify throws when a request failed its schema. */
export const isSchemaValidationError = (error: unknown): error is FastifyError =>
  Array.isArray((error as FastifyError | undefined)?.validation);

/**
 * Installs the formatter. The `{ error }` re-shaping lives in each instance's
 * error handler, because Fastify allows only one of those and `index.ts`
 * already has one doing other work.
 */
export const registerRequestSchemas = (app: FastifyInstance): void => {
  app.setSchemaErrorFormatter(schemaErrorFormatter);
};
