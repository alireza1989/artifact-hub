import { DomainError } from "@/core/errors";
import { MAX_ARTIFACT_BYTES } from "@/lib/validation";

export class ArtifactNotFoundError extends DomainError {
  readonly code = "artifact_not_found";
  constructor(id: string) {
    super(`Artifact "${id}" not found. Call search_artifacts to discover valid ids.`);
  }
}

export class FileTooLargeError extends DomainError {
  readonly code = "file_too_large";
  constructor(sizeBytes: number) {
    super(
      `File is ${sizeBytes} bytes; the limit is ${MAX_ARTIFACT_BYTES} bytes (25 MB). Upload a smaller file.`,
    );
  }
}

export class EmptyContentError extends DomainError {
  readonly code = "empty_content";
  constructor() {
    super("Artifact content is empty. Provide non-empty file content.");
  }
}
