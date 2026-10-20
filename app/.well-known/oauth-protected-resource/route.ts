// The same metadata at the bare well-known path, for a client that looks
// there before trying the one named after /mcp. The app's only protected
// resource is /mcp, so the answer is the same.

export { GET, OPTIONS } from "./mcp/route";
