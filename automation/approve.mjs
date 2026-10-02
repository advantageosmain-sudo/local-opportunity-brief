// No CLI/process identity can stand in for a human approval of a newly generated
// report. The authenticated owner dashboard binds approval to its exact checksum.
console.error("Local approval is disabled. Review and approve the exact report in the authenticated owner dashboard.");
process.exitCode = 1;
