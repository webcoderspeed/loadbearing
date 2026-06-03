// Domain entity + value objects for the Task aggregate.
// Pure domain — no framework, no I/O. (DDD: domain layer must not import infra.)

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export class TaskId {
  private constructor(public readonly value: string) {}
  static of(value: string): TaskId {
    if (!value || value.length < 3) throw new DomainError('TASK_ID_INVALID', 'Task id too short');
    return new TaskId(value);
  }
}

export class TaskTitle {
  private constructor(public readonly value: string) {}
  static of(value: string): TaskTitle {
    const trimmed = (value ?? '').trim();
    if (!trimmed) throw new DomainError('TASK_TITLE_REQUIRED', 'Title is required');
    if (trimmed.length > 120) throw new DomainError('TASK_TITLE_TOO_LONG', 'Title exceeds 120 chars');
    return new TaskTitle(trimmed);
  }
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Task {
  id: TaskId;
  title: TaskTitle;
  status: TaskStatus;
  assigneeId: string | null;
  createdAt: string;
}

export function createTask(id: string, title: string, createdAt: string): Task {
  return {
    id: TaskId.of(id),
    title: TaskTitle.of(title),
    status: 'todo',
    assigneeId: null,
    createdAt,
  };
}
