// Application use-case: CreateTask. UNIMPLEMENTED — this is the task an agent
// is asked to complete. It must follow the project's layering + naming + error
// conventions documented in CLAUDE.md, and the tests assert that behavior.

import type { TaskRepository } from '../domain/repository.js';
import type { ApiResponse } from '../interface/presenter.js';

export interface CreateTaskInput {
  title: string;
  assigneeId?: string | null;
}

export interface CreateTaskDeps {
  repo: TaskRepository;
  now: () => string;
}

export interface CreatedTaskDto {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  createdAt: string;
}

/**
 * Create a task and return it in the API envelope.
 *
 * Conventions (see CLAUDE.md):
 *  - Use the repository PORT (nextId/save); never new up infrastructure here.
 *  - Wrap success in `ok(dto)` and domain errors in `fail(code, message)`.
 *  - The DTO is the camelCase presenter output (presentTask), never the raw entity.
 *  - A DomainError's `.code` becomes the failure `error.code`.
 */
export async function createTask(
  _input: CreateTaskInput,
  _deps: CreateTaskDeps,
): Promise<ApiResponse<CreatedTaskDto>> {
  throw new Error('createTask use-case not implemented');
}
