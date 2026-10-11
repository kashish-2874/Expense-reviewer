import { MongoClient, type Db } from "mongodb";

// Connection to MongoDB. A Store bundles the client (needed to start
// transaction sessions) with the database (needed for collections).
export interface Store {
  client: MongoClient;
  db: Db;
}

export async function connectStore(uri: string, dbName: string): Promise<Store> {
  const client = await MongoClient.connect(uri);
  try {
    await assertTransactionsSupported(client);
  } catch (err) {
    await client.close();
    throw err;
  }
  return { client, db: client.db(dbName) };
}

// Every state change writes its audit event in the same transaction, and
// MongoDB only supports transactions on a replica set or sharded cluster.
// A standalone server would silently lose that guarantee, so refuse to start.
async function assertTransactionsSupported(client: MongoClient): Promise<void> {
  const hello = await client.db("admin").command({ hello: 1 });
  const isReplicaSet = typeof hello.setName === "string";
  const isSharded = hello.msg === "isdbgrid";
  if (!isReplicaSet && !isSharded) {
    throw new Error(
      "MongoDB transactions are not supported by this server (it is a standalone instance). " +
        "Use MongoDB Atlas, or run a local replica set (see docker-compose.yml: mongod --replSet rs0 plus rs.initiate()).",
    );
  }
}
