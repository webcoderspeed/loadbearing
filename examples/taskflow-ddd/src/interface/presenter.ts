// Interface-layer presenter: turns domain objects / errors into the API
// response envelope. The exact shape is a PROJECT CONVENTION (see CLAUDE.md)
// and is asserted by the tests.

import type { Task } from '../domain/task.js';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ApiFailure {
  return { ok: false, error: { code: code.toUpperCase(), message } };
}

/** Serialize a Task to the camelCase DTO clients receive. */
export function presentTask(task: Task): {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  createdAt: string;
} {
  return {
    id: task.id.value,
    title: task.title.value,
    status: task.status,
    assigneeId: task.assigneeId,
    createdAt: task.createdAt,
  };
}
