// A static host answers a missing file, or an /api/ path with no function behind it, with the app's own page (the SPA
// fallback, status 200). Only a JSON answer is the file or API that was asked for.
export const isJson = (response: Response) => (response.headers.get("content-type") ?? "").includes("json");
