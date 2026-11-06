// Every API error has the same shape (PRD section 9):
//   { "error": { "code": "SOME_CODE", "message": "What went wrong" } }
// so the frontend can always read `error.message`.
export function apiError(code, message, status) {
  return Response.json({ error: { code, message } }, { status });
}

// Reads the JSON body; returns {} if the body is missing or not valid JSON,
// so the Zod schema then reports which field is missing.
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
