// Base for typed domain errors raised in core/. Adapters (REST routes, MCP tools)
// map these to HTTP codes / MCP error results — core never throws raw strings and
// never returns framework types. See CLAUDE.md "Coding standards → Errors".
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
