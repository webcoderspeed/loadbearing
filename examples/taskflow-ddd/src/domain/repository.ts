// Repository PORT (interface) lives in the domain layer; the implementation
// lives in infrastructure. (DDD dependency rule: domain defines, infra provides.)

import type { Task } from './task.js';

export interface TaskRepository {
  save(task: Task): Promise<void>;
  findById(id: string): Promise<Task | null>;
  nextId(): string;
}
