// Architecture rules (npm run lint:arch). W-001 starts with the circular-import rule only;
// W-003 adds the module-boundary rules from CONTEXT/project_data.md Section 4.2.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports are not allowed (project_data.md 4.2 rule 7).",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/generated/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
