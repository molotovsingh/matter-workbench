# Matter Workbench Shadow DB Restore Drill

Generated at: 2026-06-05T05:53:07.036Z
Success: yes
Backup: shadow-db-backup-2026-06-05T05-15-34-455Z.sql
Restored database: matter_workbench_shadow_restore_2026_06_05T05_53_07_036Z
Cleanup: yes

This is a shadow-database restore-drill handoff artifact. It proves a local shadow backup can be restored into a temporary PostgreSQL database and verified without switching Matter Workbench runtime storage.

```text
  create restore database: ok
  restore backup: ok
  verify restored database: ok
  drop restore database: ok
```
