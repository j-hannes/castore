export class TimeoutError extends Error {
  commandId: string;
  timeout: number;

  constructor({ commandId, timeout }: { commandId: string; timeout: number }) {
    super(`Command ${commandId} timed out after ${timeout} ms.`);

    this.commandId = commandId;
    this.timeout = timeout;
  }
}
