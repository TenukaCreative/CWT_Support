// validate({ body, query, params }) parses each part with its Zod schema and replaces it with the
// parsed (coerced, stripped) value, so handlers only ever see validated data. The schemas are kept
// on the function (`schemas`) so the OpenAPI generator can describe the request.
export const validate = (schemas) =>
  Object.assign(
    (req, _res, next) => {
      try {
        for (const part of ['params', 'query', 'body']) {
          if (schemas[part]) req[part] = schemas[part].parse(req[part]);
        }
        next();
      } catch (err) {
        next(err); // ZodError is turned into a 400 by the central error handler
      }
    },
    { schemas },
  );
