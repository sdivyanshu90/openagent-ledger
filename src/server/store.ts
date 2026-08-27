import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { databaseSchema, type Database } from "../domain/schemas.js";
import { seedDatabase } from "../domain/fixtures.js";

export interface Store {
  read(): Promise<Database>;
  transaction<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  reset(): Promise<void>;
}

export class JsonStore implements Store {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filename: string) {}

  async read(): Promise<Database> {
    try {
      return databaseSchema.parse(
        JSON.parse(await readFile(this.filename, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const seed = seedDatabase();
      await this.write(seed);
      return seed;
    }
  }

  async transaction<T>(
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      const database = await this.read();
      const result = await operation(database);
      await this.write(databaseSchema.parse(database));
      return result;
    } finally {
      release();
    }
  }

  async reset(): Promise<void> {
    await this.transaction((database) =>
      Object.assign(database, seedDatabase()),
    );
  }

  private async write(database: Database): Promise<void> {
    await mkdir(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filename);
  }
}

export class MemoryStore implements Store {
  constructor(private database: Database = seedDatabase()) {}
  read(): Promise<Database> {
    return Promise.resolve(structuredClone(this.database));
  }
  async transaction<T>(
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    const draft = structuredClone(this.database);
    const result = await operation(draft);
    this.database = databaseSchema.parse(draft);
    return result;
  }
  reset(): Promise<void> {
    this.database = seedDatabase();
    return Promise.resolve();
  }
}
