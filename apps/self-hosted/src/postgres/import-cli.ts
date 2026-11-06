import { importSqlite, ImportTextCompatibilityError } from "./import-sqlite";
const sourceDirectory = process.argv[2];
const destinationUrl = process.env.SAVIA_POSTGRES_URL;
if (!sourceDirectory || !destinationUrl) {
  console.error(
    "Usage: SAVIA_POSTGRES_URL=<destination> import-sqlite <stopped SQLite data directory>",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(
      JSON.stringify(
        await importSqlite({ sourceDirectory, destinationUrl }),
        null,
        2,
      ),
    );
  } catch (error) {
    if (error instanceof ImportTextCompatibilityError)
      console.error(error.message);
    console.error(
      "SQLite import failed. No imported data was committed. Check source compatibility and an empty destination.",
    );
    process.exitCode = 1;
  }
}
