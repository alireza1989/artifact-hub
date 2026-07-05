// Idempotent demo seed (PLAN §7). Implemented in Phase 5.
async function main(): Promise<void> {
  console.log("db:seed — implemented in Phase 5 (see PLAN §7 Seed data).");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
