import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

// Starts ONE in-memory MongoDB for the whole test run. It is a single-node
// replica set (not a standalone server) because the app needs transactions.
// Each test then uses its own throwaway database (see helpers/testDatabase.ts).
// The first run downloads a MongoDB binary, which can take a few minutes.

export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  project.provide("mongoUri", replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
