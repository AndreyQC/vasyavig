/** Ошибка исполнения инструмента с машинным кодом для UI/тестов. */
export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
