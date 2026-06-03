// Infrastructure ADAPTER implementing the domain repository port.

import type { TaskRepository } from '../domain/repository.js';
import type { Task } from '../domain/task.js';

export class InMemoryTaskRepository implements TaskRepository {
  private store = new Map<string, Task>();
  private seq = 0;

  async save(task: Task): Promise<void> {
    this.store.set(task.id.value, task);
  }

  async findById(id: string): Promise<Task | null> {
    return this.store.get(id) ?? null;
  }

  nextId(): string {
    this.seq += 1;
    return `task-${String(this.seq).padStart(4, '0')}`;
  }
}
