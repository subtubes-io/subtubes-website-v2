import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reportSnapshot")
    .dropConstraint("report_snapshot_report_id_fk")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reportSnapshot")
    .addForeignKeyConstraint(
      "report_snapshot_report_id_fk",
      ["reportId"],
      "report",
      ["id"],
      (constraint) => constraint.onDelete("cascade")
    )
    .execute();
}
