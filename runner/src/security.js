import path from "node:path";
import fs from "node:fs/promises";

export class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityError";
  }
}

export async function createWorkspaceGuard(workspaceDir) {
  const resolvedRoot = path.resolve(workspaceDir);
  const realRoot = await fs.realpath(resolvedRoot).catch(() => resolvedRoot);

  function assertInside(targetPath) {
    const resolved = path.resolve(realRoot, targetPath);
    if (!resolved.startsWith(realRoot + path.sep) && resolved !== realRoot) {
      throw new SecurityError(`Path "${targetPath}" resolves outside of workspace root: ${realRoot}`);
    }
    return resolved;
  }

  return {
    root: realRoot,
    resolveSafe(targetPath) {
      return assertInside(targetPath);
    }
  };
}
